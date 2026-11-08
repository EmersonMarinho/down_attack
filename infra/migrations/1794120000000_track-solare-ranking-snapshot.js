/**
 * 1. Tracks when each Solare player's official `current_ranking` (`GetRankList` `_ranking`) last
 *    changed (`ranking_changed_at`, `ranking_games_snapshot`).
 * 2. Preserves inactivity `'decay'` events on unseeded (`inferred_start`) players so subsequent
 *    inference passes never overwrite decayed ratings back to pre-decay values.
 * 3. Cleans up stale "ghost" duplicate `current_ranking < 999` rows where a newer snapshot holds
 *    the same official rank, and runs a Longest Non-Increasing Subsequence (LNIS) monotonic
 *    reconciliation pass across all synchronized ranked players.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE solare_players
      ADD COLUMN IF NOT EXISTS ranking_changed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ranking_games_snapshot INTEGER;

    UPDATE solare_players
    SET
      ranking_changed_at = COALESCE(last_seen_at, updated_at),
      ranking_games_snapshot = COALESCE(win_count, 0) + COALESCE(lose_count, 0) + COALESCE(draw_count, 0)
    WHERE ranking_changed_at IS NULL;

    CREATE OR REPLACE FUNCTION fn_trg_solare_player_track_ranking_snapshot()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'INSERT' OR NEW.current_ranking IS DISTINCT FROM OLD.current_ranking THEN
        NEW.ranking_changed_at := timezone('utc', now());
        NEW.ranking_games_snapshot :=
          COALESCE(NEW.win_count, 0) + COALESCE(NEW.lose_count, 0) + COALESCE(NEW.draw_count, 0);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_solare_player_track_ranking_snapshot ON solare_players;

    CREATE TRIGGER trg_solare_player_track_ranking_snapshot
    BEFORE INSERT OR UPDATE OF current_ranking
    ON solare_players
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_solare_player_track_ranking_snapshot();
  `);

  // Ensure 'decay' events on unseeded players are treated as authoritative checkpoints
  // by both fn_infer_unseeded_solare_player_rating and fn_apply_solare_match_rating_delta.
  pgm.sql(`
    DO $$
    DECLARE
      v_fn_def TEXT;
    BEGIN
      SELECT pg_get_functiondef('fn_infer_unseeded_solare_player_rating(character varying,bigint,character varying)'::regprocedure)
      INTO v_fn_def;

      IF v_fn_def IS NOT NULL THEN
        v_fn_def := replace(
          v_fn_def,
          'AND ep.event_type IN (''season_reset'', ''seed_anchor'', ''reconcile'')',
          'AND ep.event_type IN (''season_reset'', ''seed_anchor'', ''reconcile'', ''decay'')'
        );
        EXECUTE v_fn_def;
      END IF;

      SELECT pg_get_functiondef('fn_apply_solare_match_rating_delta()'::regprocedure)
      INTO v_fn_def;

      IF v_fn_def IS NOT NULL THEN
        v_fn_def := replace(
          v_fn_def,
          'AND ep.event_type IN (''season_reset'', ''seed_anchor'', ''reconcile'')',
          'AND ep.event_type IN (''season_reset'', ''seed_anchor'', ''reconcile'', ''decay'')'
        );
        EXECUTE v_fn_def;
      END IF;
    END;
    $$;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_reconcile_solare_monotonic_ratings(
      p_region VARCHAR,
      p_season SMALLINT DEFAULT 9
    )
    RETURNS INTEGER AS $$
    DECLARE
      v_target_season SMALLINT := COALESCE(p_season, 9)::smallint;
      v_user_nos BIGINT[];
      v_nicks VARCHAR[];
      v_ranks INTEGER[];
      v_ratings INTEGER[];
      v_achieved_rns BIGINT[];
      v_n INTEGER;
      v_lengths INTEGER[];
      v_prev INTEGER[];
      v_kept BOOLEAN[];
      v_best_end INTEGER := 1;
      v_curr INTEGER;
      v_upper_idx INTEGER;
      v_lower_idx INTEGER;
      v_upper_rating INTEGER;
      v_lower_rating INTEGER;
      v_upper_rank INTEGER;
      v_lower_rank INTEGER;
      v_target_rating INTEGER;
      v_reconciled_count INTEGER := 0;
      i INTEGER;
      j INTEGER;
    BEGIN
      -- 1. Clear stale duplicate current_ranking < 999 where a newer snapshot holds the same rank
      WITH active_holders AS (
        SELECT DISTINCT ON (sp.current_ranking)
          sp.user_no,
          sp.user_nickname,
          sp.current_ranking
        FROM solare_players sp
        WHERE sp.region = p_region
          AND sp.current_ranking IS NOT NULL
          AND sp.current_ranking >= 1
          AND sp.current_ranking < 999
          AND (sp.season = v_target_season OR (v_target_season = 9 AND sp.season IS NULL))
        ORDER BY
          sp.current_ranking ASC,
          COALESCE(sp.last_seen_at, sp.updated_at) DESC NULLS LAST,
          sp.updated_at DESC NULLS LAST,
          sp.win_count DESC
      )
      UPDATE solare_players sp
      SET
        current_ranking = NULL,
        updated_at = timezone('utc', now())
      FROM active_holders ah
      WHERE sp.region = p_region
        AND (sp.season = v_target_season OR (v_target_season = 9 AND sp.season IS NULL))
        AND sp.current_ranking = ah.current_ranking
        AND (
          (sp.user_no IS NOT NULL AND ah.user_no IS NOT NULL AND sp.user_no <> ah.user_no)
          OR ((sp.user_no IS NULL OR ah.user_no IS NULL) AND LOWER(sp.user_nickname) <> LOWER(ah.user_nickname))
        );

      -- 2. Collect synchronized ranked players ordered by official current_ranking ASC
      SELECT
        ARRAY_AGG(s.user_no ORDER BY s.current_ranking ASC),
        ARRAY_AGG(s.user_nickname ORDER BY s.current_ranking ASC),
        ARRAY_AGG(s.current_ranking ORDER BY s.current_ranking ASC),
        ARRAY_AGG(s.rank_rating ORDER BY s.current_ranking ASC),
        ARRAY_AGG(s.rating_achieved_record_no ORDER BY s.current_ranking ASC)
      INTO
        v_user_nos,
        v_nicks,
        v_ranks,
        v_ratings,
        v_achieved_rns
      FROM (
        SELECT DISTINCT ON (sp.current_ranking)
          sp.user_no,
          sp.user_nickname,
          sp.current_ranking,
          sp.rank_rating,
          sp.rating_achieved_record_no,
          (
            sp.last_seen_at IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM solare_match_players mp_post
              INNER JOIN solare_matches m_post
                ON m_post.region = mp_post.region AND m_post.record_no = mp_post.record_no
              LEFT JOIN solare_match_mode_proofs pr_post
                ON pr_post.region = mp_post.region AND pr_post.record_no = mp_post.record_no
              WHERE mp_post.region = sp.region
                AND COALESCE(pr_post.mode, '') <> 'practice'
                AND COALESCE(m_post.season, 9) = COALESCE(sp.season, v_target_season)
                AND (
                  (sp.user_no IS NOT NULL AND mp_post.user_no = sp.user_no)
                  OR ((sp.user_no IS NULL OR mp_post.user_no IS NULL) AND LOWER(mp_post.user_nickname) = LOWER(sp.user_nickname))
                )
                AND m_post.match_date IS NOT NULL
                AND m_post.match_date > sp.last_seen_at + INTERVAL '10 seconds'
            )
          ) AS has_post_snapshot_match
        FROM solare_players sp
        WHERE sp.region = p_region
          AND sp.current_ranking IS NOT NULL
          AND sp.current_ranking >= 1
          AND (sp.season = v_target_season OR (v_target_season = 9 AND sp.season IS NULL))
        ORDER BY
          sp.current_ranking ASC,
          COALESCE(sp.last_seen_at, sp.updated_at) DESC NULLS LAST,
          sp.updated_at DESC NULLS LAST
      ) s
      WHERE s.rank_rating IS NOT NULL
        AND NOT s.has_post_snapshot_match;

      v_n := COALESCE(ARRAY_LENGTH(v_ratings, 1), 0);
      IF v_n <= 1 THEN
        RETURN 0;
      END IF;

      v_lengths := ARRAY_FILL(1, ARRAY[v_n]);
      v_prev := ARRAY_FILL(0, ARRAY[v_n]);
      v_kept := ARRAY_FILL(FALSE, ARRAY[v_n]);

      FOR i IN 1..v_n LOOP
        IF i > 1 THEN
          FOR j IN 1..(i - 1) LOOP
            IF v_ratings[j] >= v_ratings[i] AND v_lengths[j] + 1 > v_lengths[i] THEN
              v_lengths[i] := v_lengths[j] + 1;
              v_prev[i] := j;
            END IF;
          END LOOP;
        END IF;
        IF v_lengths[i] > v_lengths[v_best_end] THEN
          v_best_end := i;
        END IF;
      END LOOP;

      v_curr := v_best_end;
      WHILE v_curr > 0 LOOP
        v_kept[v_curr] := TRUE;
        v_curr := v_prev[v_curr];
      END LOOP;

      FOR i IN 1..v_n LOOP
        IF v_kept[i] THEN
          CONTINUE;
        END IF;

        v_upper_idx := 0;
        IF i > 1 THEN
          FOR j IN REVERSE (i - 1)..1 LOOP
            IF v_kept[j] THEN
              v_upper_idx := j;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        v_lower_idx := 0;
        IF i < v_n THEN
          FOR j IN (i + 1)..v_n LOOP
            IF v_kept[j] THEN
              v_lower_idx := j;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        v_upper_rating := CASE WHEN v_upper_idx > 0 THEN v_ratings[v_upper_idx] ELSE NULL END;
        v_lower_rating := CASE WHEN v_lower_idx > 0 THEN v_ratings[v_lower_idx] ELSE NULL END;
        v_upper_rank := CASE WHEN v_upper_idx > 0 THEN v_ranks[v_upper_idx] ELSE NULL END;
        v_lower_rank := CASE WHEN v_lower_idx > 0 THEN v_ranks[v_lower_idx] ELSE NULL END;

        v_target_rating := v_ratings[i];
        IF v_upper_rating IS NOT NULL
           AND v_lower_rating IS NOT NULL
           AND v_lower_rank IS NOT NULL
           AND v_upper_rank IS NOT NULL
           AND v_lower_rank > v_upper_rank THEN
          v_target_rating := ROUND(
            v_upper_rating
            - (v_upper_rating - v_lower_rating)::numeric
              * (v_ranks[i] - v_upper_rank)
              / (v_lower_rank - v_upper_rank)
          )::integer;
          v_target_rating := GREATEST(v_lower_rating, LEAST(v_upper_rating, v_target_rating));
        ELSIF v_upper_rating IS NOT NULL AND v_target_rating > v_upper_rating THEN
          v_target_rating := v_upper_rating;
        ELSIF v_lower_rating IS NOT NULL AND v_target_rating < v_lower_rating THEN
          v_target_rating := v_lower_rating;
        END IF;

        IF v_target_rating IS DISTINCT FROM v_ratings[i] THEN
          UPDATE solare_players
          SET
            rank_rating = v_target_rating,
            rating_is_estimated = FALSE,
            updated_at = timezone('utc', now())
          WHERE region = p_region
            AND user_no = v_user_nos[i];

          INSERT INTO solare_player_rating_events (
            region,
            season,
            user_no,
            user_nickname,
            record_no,
            event_type,
            previous_rating,
            rating_delta,
            new_rating,
            metadata
          )
          VALUES (
            p_region,
            v_target_season,
            v_user_nos[i],
            v_nicks[i],
            v_achieved_rns[i],
            'reconcile',
            v_ratings[i],
            v_target_rating - v_ratings[i],
            v_target_rating,
            jsonb_build_object(
              'reason', 'daily_ranking_clamp',
              'current_ranking', v_ranks[i],
              'upper_rank', v_upper_rank,
              'upper_rating', v_upper_rating,
              'lower_rank', v_lower_rank,
              'lower_rating', v_lower_rating
            )
          );

          v_reconciled_count := v_reconciled_count + 1;
        END IF;
      END LOOP;

      RETURN v_reconciled_count;
    END;
    $$ LANGUAGE plpgsql;

    DO $$
    DECLARE
      v_reg RECORD;
    BEGIN
      FOR v_reg IN
        SELECT DISTINCT
          region,
          COALESCE(season, 9)::smallint AS season
        FROM solare_players
        WHERE current_ranking IS NOT NULL
      LOOP
        PERFORM fn_reconcile_solare_monotonic_ratings(v_reg.region, v_reg.season);
      END LOOP;
    END;
    $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS fn_reconcile_solare_monotonic_ratings(VARCHAR, SMALLINT);
    DROP TRIGGER IF EXISTS trg_solare_player_track_ranking_snapshot ON solare_players;
    DROP FUNCTION IF EXISTS fn_trg_solare_player_track_ranking_snapshot();
    ALTER TABLE solare_players
      DROP COLUMN IF EXISTS ranking_changed_at,
      DROP COLUMN IF EXISTS ranking_games_snapshot;
  `);
};
