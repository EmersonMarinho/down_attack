/**
 * 1. Adds `fn_apply_solare_inactivity_decay(p_region, p_season, p_now)` in PostgreSQL so
 *    inactivity decay is automatically evaluated during migrations and at the end of each
 *    region's daily Ranked window (`fn_refresh_solare_practice_suspects`).
 * 2. Respects `seed_anchor` `snapshot_date` watermarks and bounds `last_match_at` by subsequent
 *    regional `record_no` timestamps so backfilled matches without `.repz` do not mask decay,
 *    nor do pre-snapshot decays get double-subtracted after seeding.
 * 3. Clears stale estimated-only ratings (`rating_is_estimated = TRUE`) when `current_ranking`
 *    is cleared to `NULL`, and runs `fn_apply_solare_inactivity_decay` across all regions.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_apply_solare_inactivity_decay(
      p_region VARCHAR DEFAULT NULL,
      p_season SMALLINT DEFAULT NULL,
      p_now TIMESTAMPTZ DEFAULT timezone('utc', now())
    )
    RETURNS INTEGER AS $$
    DECLARE
      v_cand RECORD;
      v_now_ms BIGINT;
      v_last_match_ms BIGINT;
      v_raw_last_decay_ms BIGINT;
      v_last_decay_ms BIGINT;
      v_snapshot_ms BIGINT;
      v_reconcile_ms BIGINT;
      v_current_rating INTEGER;
      v_grace_days INTEGER;
      v_interval_days INTEGER;
      v_penalty INTEGER;
      v_ms_per_day BIGINT := 86400000;
      v_first_threshold_ms BIGINT;
      v_intervals INTEGER;
      v_next_watermark_ms BIGINT;
      v_next_watermark_ts TIMESTAMPTZ;
      v_new_rating INTEGER;
      v_applied_delta INTEGER;
      v_decayed_count INTEGER := 0;
    BEGIN
      IF p_now IS NULL THEN
        p_now := timezone('utc', now());
      END IF;

      v_now_ms := FLOOR(EXTRACT(EPOCH FROM p_now) * 1000)::bigint;

      FOR v_cand IN
        SELECT
          sp.region,
          sp.season,
          sp.user_no,
          sp.user_nickname,
          sp.rank_rating,
          sp.last_decay_at,
          COALESCE(
            CASE
              WHEN latest_mp.raw_match_at IS NOT NULL THEN
                LEAST(
                  latest_mp.raw_match_at,
                  COALESCE(
                    (
                      SELECT MIN(m_next.match_date)
                      FROM (
                        SELECT m2.match_date
                        FROM solare_matches m2
                        WHERE m2.region = sp.region
                          AND m2.record_no > latest_mp.record_no
                          AND m2.match_date IS NOT NULL
                        ORDER BY m2.record_no ASC
                        LIMIT 25
                      ) m_next
                    ),
                    latest_mp.raw_match_at
                  )
                )
              ELSE NULL
            END,
            sp.rating_achieved_at,
            sp.last_seen_at
          ) AS last_match_at,
          COALESCE(latest_decay.id, 0) AS latest_decay_event_id,
          COALESCE(latest_reset.id, 0) AS latest_reset_event_id,
          latest_reset.event_type AS latest_reset_event_type,
          latest_reset.created_at AS latest_reset_created_at,
          latest_reset.metadata->>'snapshot_date' AS seed_snapshot_date,
          COALESCE((latest_reset.metadata->>'extra_games_fast_forwarded')::int, 0) AS seed_extra_games
        FROM solare_players sp
        LEFT JOIN LATERAL (
          SELECT
            mp.record_no,
            COALESCE(m.match_date, m.crawled_at, mp.created_at) AS raw_match_at
          FROM solare_match_players mp
          LEFT JOIN solare_matches m
            ON m.region = mp.region AND m.record_no = mp.record_no
          WHERE mp.region = sp.region
            AND (
              p_season IS NULL
              OR m.season = p_season
              OR (p_season = 9 AND m.season IS NULL)
            )
            AND (
              (sp.user_no IS NOT NULL AND mp.user_no = sp.user_no)
              OR (sp.user_no IS NULL AND LOWER(mp.user_nickname) = LOWER(sp.user_nickname))
            )
            AND NOT EXISTS (
              SELECT 1
              FROM solare_match_mode_proofs smp
              WHERE smp.region = mp.region
                AND smp.record_no = mp.record_no
                AND smp.mode = 'practice'
            )
          ORDER BY mp.record_no DESC
          LIMIT 1
        ) latest_mp ON true
        LEFT JOIN LATERAL (
          SELECT ed.id
          FROM solare_player_rating_events ed
          WHERE ed.region = sp.region
            AND (
              (sp.user_no IS NOT NULL AND ed.user_no = sp.user_no)
              OR (sp.user_no IS NULL AND LOWER(ed.user_nickname) = LOWER(sp.user_nickname))
            )
            AND ed.event_type = 'decay'
          ORDER BY ed.id DESC
          LIMIT 1
        ) latest_decay ON true
        LEFT JOIN LATERAL (
          SELECT er.id, er.event_type, er.created_at, er.metadata
          FROM solare_player_rating_events er
          WHERE er.region = sp.region
            AND (
              (sp.user_no IS NOT NULL AND er.user_no = sp.user_no)
              OR (sp.user_no IS NULL AND LOWER(er.user_nickname) = LOWER(sp.user_nickname))
            )
            AND er.event_type IN ('season_reset', 'seed_anchor', 'inferred_start', 'reconcile')
          ORDER BY er.id DESC
          LIMIT 1
        ) latest_reset ON true
        WHERE sp.rank_rating IS NOT NULL
          AND NOT COALESCE(sp.rating_is_estimated, FALSE)
          AND sp.rank_rating >= 1801
          AND (p_region IS NULL OR sp.region = UPPER(TRIM(p_region)))
          AND (
            p_season IS NULL
            OR sp.season = p_season
            OR (p_season = 9 AND sp.season IS NULL)
          )
      LOOP
        IF v_cand.last_match_at IS NULL THEN
          CONTINUE;
        END IF;

        v_last_match_ms := FLOOR(EXTRACT(EPOCH FROM v_cand.last_match_at) * 1000)::bigint;
        IF v_now_ms <= v_last_match_ms THEN
          CONTINUE;
        END IF;

        v_current_rating := v_cand.rank_rating;
        v_grace_days := CASE WHEN v_current_rating >= 2101 THEN 2 ELSE 3 END;
        v_interval_days := CASE WHEN v_current_rating >= 2101 THEN 1 ELSE 2 END;
        v_penalty := CASE
          WHEN v_current_rating >= 2401 THEN 50
          WHEN v_current_rating >= 2101 THEN 40
          ELSE 30
        END;

        v_first_threshold_ms := v_last_match_ms + v_grace_days * v_ms_per_day;
        IF v_now_ms < v_first_threshold_ms THEN
          CONTINUE;
        END IF;

        v_raw_last_decay_ms := CASE
          WHEN v_cand.last_decay_at IS NOT NULL THEN
            FLOOR(EXTRACT(EPOCH FROM v_cand.last_decay_at) * 1000)::bigint
          ELSE NULL
        END;
        v_last_decay_ms := v_raw_last_decay_ms;

        IF v_cand.latest_reset_event_id > v_cand.latest_decay_event_id THEN
          IF v_cand.latest_reset_event_type = 'seed_anchor'
             AND v_cand.seed_extra_games = 0
             AND v_cand.seed_snapshot_date IS NOT NULL THEN
            BEGIN
              v_snapshot_ms := FLOOR(EXTRACT(EPOCH FROM ((v_cand.seed_snapshot_date::date)::timestamp AT TIME ZONE 'UTC')) * 1000)::bigint;
              IF v_snapshot_ms >= v_first_threshold_ms THEN
                v_last_decay_ms := v_snapshot_ms;
              ELSE
                v_last_decay_ms := NULL;
              END IF;
            EXCEPTION WHEN OTHERS THEN
              v_last_decay_ms := v_raw_last_decay_ms;
            END;
          ELSIF v_cand.latest_reset_event_type IN ('inferred_start', 'season_reset') THEN
            v_last_decay_ms := NULL;
          ELSIF v_cand.latest_reset_event_type = 'reconcile'
                AND v_cand.latest_reset_created_at IS NOT NULL THEN
            v_reconcile_ms := FLOOR(EXTRACT(EPOCH FROM v_cand.latest_reset_created_at) * 1000)::bigint;
            IF v_raw_last_decay_ms IS NOT NULL THEN
              v_last_decay_ms := GREATEST(v_raw_last_decay_ms, v_reconcile_ms);
            ELSE
              v_last_decay_ms := v_reconcile_ms;
            END IF;
          END IF;
        END IF;

        v_intervals := 0;
        v_next_watermark_ms := v_last_decay_ms;

        IF v_last_decay_ms IS NULL OR v_last_decay_ms < v_first_threshold_ms THEN
          v_intervals := 1 + ((v_now_ms - v_first_threshold_ms) / (v_interval_days * v_ms_per_day))::integer;
          v_next_watermark_ms := v_first_threshold_ms + (v_intervals - 1)::bigint * v_interval_days * v_ms_per_day;
        ELSE
          v_intervals := ((v_now_ms - v_last_decay_ms) / (v_interval_days * v_ms_per_day))::integer;
          IF v_intervals > 0 THEN
            v_next_watermark_ms := v_last_decay_ms + v_intervals::bigint * v_interval_days * v_ms_per_day;
          END IF;
        END IF;

        IF v_intervals <= 0 THEN
          CONTINUE;
        END IF;

        v_new_rating := GREATEST(1800, v_current_rating - (v_intervals * v_penalty));
        v_applied_delta := v_new_rating - v_current_rating;

        IF v_applied_delta = 0 THEN
          CONTINUE;
        END IF;

        v_next_watermark_ts := to_timestamp(v_next_watermark_ms::double precision / 1000.0);

        UPDATE solare_players
        SET
          rank_rating = v_new_rating,
          last_decay_at = v_next_watermark_ts,
          updated_at = timezone('utc', now())
        WHERE region = v_cand.region
          AND (
            (v_cand.user_no IS NOT NULL AND user_no = v_cand.user_no)
            OR (v_cand.user_no IS NULL AND LOWER(user_nickname) = LOWER(v_cand.user_nickname))
          );

        INSERT INTO solare_player_rating_events (
          region,
          season,
          user_no,
          user_nickname,
          event_type,
          previous_rating,
          rating_delta,
          new_rating
        )
        VALUES (
          v_cand.region,
          v_cand.season,
          v_cand.user_no,
          v_cand.user_nickname,
          'decay',
          v_current_rating,
          v_applied_delta,
          v_new_rating
        );

        v_decayed_count := v_decayed_count + 1;
      END LOOP;

      RETURN v_decayed_count;
    END;
    $$ LANGUAGE plpgsql;

    -- Clear lingering estimated-only ratings on rows whose official current_ranking was already cleared to NULL
    UPDATE solare_players
    SET
      rank_rating = NULL,
      rating_is_estimated = FALSE,
      updated_at = timezone('utc', now())
    WHERE current_ranking IS NULL
      AND COALESCE(rating_is_estimated, FALSE) = TRUE;

    -- Ensure fn_reconcile_solare_monotonic_ratings also clears estimated-only ratings when clearing duplicate current_ranking
    DO $$
    DECLARE
      v_fn_def TEXT;
    BEGIN
      SELECT pg_get_functiondef('fn_reconcile_solare_monotonic_ratings(character varying,smallint)'::regprocedure)
      INTO v_fn_def;

      IF v_fn_def IS NOT NULL THEN
        v_fn_def := replace(
          v_fn_def,
          'current_ranking = NULL,',
          'current_ranking = NULL, rank_rating = CASE WHEN COALESCE(sp.rating_is_estimated, FALSE) THEN NULL ELSE sp.rank_rating END, rating_is_estimated = FALSE,'
        );
        EXECUTE v_fn_def;
      END IF;

      SELECT pg_get_functiondef('fn_refresh_solare_practice_suspects(character varying,bigint,boolean)'::regprocedure)
      INTO v_fn_def;

      IF v_fn_def IS NOT NULL AND position('fn_apply_solare_inactivity_decay' IN v_fn_def) = 0 THEN
        v_fn_def := replace(
          v_fn_def,
          'PERFORM fn_reconcile_solare_monotonic_ratings(p_region, NULL);',
          'PERFORM fn_apply_solare_inactivity_decay(p_region, NULL, timezone(''utc'', now())); PERFORM fn_reconcile_solare_monotonic_ratings(p_region, NULL);'
        );
        EXECUTE v_fn_def;
      END IF;
    END;
    $$;

    -- Apply pending inactivity decay across all regions immediately
    SELECT fn_apply_solare_inactivity_decay(NULL, NULL, timezone('utc', now()));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    DECLARE
      v_fn_def TEXT;
    BEGIN
      SELECT pg_get_functiondef('fn_refresh_solare_practice_suspects(character varying,bigint,boolean)'::regprocedure)
      INTO v_fn_def;

      IF v_fn_def IS NOT NULL THEN
        v_fn_def := replace(
          v_fn_def,
          'PERFORM fn_apply_solare_inactivity_decay(p_region, NULL, timezone(''utc'', now())); PERFORM fn_reconcile_solare_monotonic_ratings(p_region, NULL);',
          'PERFORM fn_reconcile_solare_monotonic_ratings(p_region, NULL);'
        );
        EXECUTE v_fn_def;
      END IF;
    END;
    $$;

    DROP FUNCTION IF EXISTS fn_apply_solare_inactivity_decay(VARCHAR, SMALLINT, TIMESTAMPTZ);
  `);
};
