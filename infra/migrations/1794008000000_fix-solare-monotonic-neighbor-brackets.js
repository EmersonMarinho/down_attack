/**
 * Resolves inverted neighbor brackets (`upper_bound < lower_bound`) caused by stale
 * ranking snapshots on adjacent ranks, enables exact base-401 tail inference below
 * the lowest anchored rank, and backfills initial W/L/D checkpoints and blocked ratings.
 *
 * 1. `fn_get_solare_monotonic_neighbor_bounds`:
 *    - Selects nearest synchronized non-estimated active rank holders above (`up_a`)
 *      and below (`low_b`) a player's `current_ranking`.
 *    - When `up_a < low_b` (an inversion between immediate neighbors), evaluates both
 *      monotonic Candidate A (`up_a` paired with the nearest `low_a <= up_a` below) and
 *      Candidate B (`low_b` paired with the nearest `up_b >= low_b` above), choosing
 *      the pair that satisfies the `<= 40` interpolation threshold with the smallest
 *      rank span (`low_rank - up_rank`) and rating gap (`up - low`).
 * 2. `fn_process_solare_player_wl_checkpoint` & `fn_infer_unseeded_solare_player_rating`:
 *    - Use `fn_get_solare_monotonic_neighbor_bounds` so stale inverted neighbors never
 *      block `checkpoint_math`, `trigger_math`, base-rating inference, or neighbor
 *      interpolation (`rating_is_estimated = TRUE`).
 *    - Allow exact base-401 inference at the leaderboard tail (`v_lower_bound IS NULL`
 *      and `v_upper_bound IS NOT NULL`) when a player has 100% synchronized match
 *      history (`db_w = win_count`, `db_l = lose_count`, `db_d = draw_count`) and
 *      `401 + total_delta` lands within `[v_upper_bound - 45, v_upper_bound]`.
 * 3. Backfill pass:
 *    - Seeds initial `solare_player_wl_checkpoints` for synchronized ranked players
 *      and runs multi-pass rating inference across all regions.
 */
exports.up = (pgm) => {
  // Ensure objects added in the second revision of 1794007000000 exist in environments
  // (such as Staging) that applied the initial revision of 1794007000000 before
  // solare_player_wl_checkpoints was introduced.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS solare_match_mode_proofs_region_mode_record_no_idx
    ON solare_match_mode_proofs (region, mode, record_no);

    CREATE TABLE IF NOT EXISTS solare_player_wl_checkpoints (
      region varchar(8) NOT NULL,
      user_no bigint NOT NULL,
      season smallint NOT NULL DEFAULT 9,
      checkpoint_record_no bigint NOT NULL DEFAULT 0,
      checkpoint_at timestamptz NOT NULL,
      win_count integer NOT NULL DEFAULT 0,
      lose_count integer NOT NULL DEFAULT 0,
      draw_count integer NOT NULL DEFAULT 0,
      checkpoint_rating integer,
      checkpoint_rating_is_estimated boolean NOT NULL DEFAULT FALSE,
      updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      PRIMARY KEY (region, user_no, season, checkpoint_record_no)
    );

    CREATE OR REPLACE FUNCTION fn_is_solare_practice_contradicted(
      p_region VARCHAR,
      p_record_no BIGINT,
      p_self_user_no BIGINT,
      p_self_nickname VARCHAR,
      p_season INTEGER
    )
    RETURNS BOOLEAN AS $$
    DECLARE
      v_target_season SMALLINT := COALESCE(p_season, 9)::smallint;
      v_part RECORD;
      v_cp_prev RECORD;
      v_cp_curr RECORD;
      v_has_late_pre BOOLEAN;
      v_int_w INTEGER;
      v_int_l INTEGER;
      v_int_d INTEGER;
      v_dw INTEGER;
      v_dl INTEGER;
      v_dd INTEGER;
      v_tot_w INTEGER;
      v_tot_l INTEGER;
      v_tot_d INTEGER;
    BEGIN
      FOR v_part IN
        SELECT
          sp2.user_no,
          sp2.user_nickname,
          sp2.season,
          sp2.win_count,
          sp2.lose_count,
          sp2.draw_count,
          sp2.last_seen_at,
          CASE
            WHEN mp2.is_winner THEN 'w'
            WHEN EXISTS (
              SELECT 1
              FROM solare_match_players w2
              WHERE w2.region = mp2.region
                AND w2.record_no = mp2.record_no
                AND w2.is_winner
            ) THEN 'l'
            ELSE 'd'
          END AS outcome
        FROM solare_match_players mp2
        INNER JOIN solare_players sp2
          ON sp2.region = mp2.region
         AND (
           (mp2.user_no IS NOT NULL AND sp2.user_no = mp2.user_no)
           OR (mp2.user_no IS NULL AND LOWER(sp2.user_nickname) = LOWER(mp2.user_nickname))
         )
        WHERE mp2.region = p_region
          AND mp2.record_no = p_record_no
          AND NOT (
            (p_self_user_no IS NOT NULL AND sp2.user_no = p_self_user_no)
            OR (p_self_user_no IS NULL AND LOWER(sp2.user_nickname) = LOWER(COALESCE(p_self_nickname, '')))
          )
          AND sp2.current_ranking IS NOT NULL
          AND sp2.current_ranking >= 1
          AND (
            sp2.season = v_target_season
            OR (v_target_season = 9 AND sp2.season IS NULL)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM solare_players sp_newer
            WHERE sp_newer.region = sp2.region
              AND sp_newer.current_ranking = sp2.current_ranking
              AND NOT (
                (sp2.user_no IS NOT NULL AND sp_newer.user_no = sp2.user_no)
                OR (sp2.user_no IS NULL AND sp_newer.user_no IS NULL AND LOWER(sp_newer.user_nickname) = LOWER(sp2.user_nickname))
              )
              AND (
                sp_newer.season = v_target_season
                OR (v_target_season = 9 AND sp_newer.season IS NULL)
              )
              AND COALESCE(sp_newer.last_seen_at, sp_newer.updated_at) > COALESCE(sp2.last_seen_at, sp2.updated_at)
          )
          AND (
            sp2.last_seen_at IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM solare_match_players mp_post
              INNER JOIN solare_matches m_post
                ON m_post.region = mp_post.region AND m_post.record_no = mp_post.record_no
              LEFT JOIN solare_match_mode_proofs pr_post
                ON pr_post.region = mp_post.region AND pr_post.record_no = mp_post.record_no
              WHERE mp_post.region = sp2.region
                AND COALESCE(pr_post.mode, '') <> 'practice'
                AND (
                  (sp2.user_no IS NOT NULL AND mp_post.user_no = sp2.user_no)
                  OR ((sp2.user_no IS NULL OR mp_post.user_no IS NULL) AND LOWER(mp_post.user_nickname) = LOWER(sp2.user_nickname))
                )
                AND COALESCE(m_post.season, 9) = COALESCE(sp2.season, v_target_season)
                AND m_post.match_date IS NOT NULL
                AND m_post.match_date > sp2.last_seen_at + INTERVAL '10 seconds'
            )
          )
      LOOP
        IF v_part.user_no IS NOT NULL THEN
          SELECT *
          INTO v_cp_prev
          FROM solare_player_wl_checkpoints
          WHERE region = p_region
            AND user_no = v_part.user_no
            AND season = COALESCE(v_part.season, v_target_season)
            AND checkpoint_record_no < p_record_no
          ORDER BY checkpoint_record_no DESC
          LIMIT 1;

          IF FOUND THEN
            SELECT *
            INTO v_cp_curr
            FROM solare_player_wl_checkpoints
            WHERE region = p_region
              AND user_no = v_part.user_no
              AND season = COALESCE(v_part.season, v_target_season)
              AND checkpoint_record_no >= p_record_no
            ORDER BY checkpoint_record_no ASC
            LIMIT 1;

            IF FOUND THEN
              SELECT EXISTS (
                SELECT 1
                FROM solare_match_players mp_l
                INNER JOIN solare_matches m_l
                  ON m_l.region = mp_l.region AND m_l.record_no = mp_l.record_no
                WHERE mp_l.region = p_region
                  AND mp_l.user_no = v_part.user_no
                  AND mp_l.record_no > v_cp_prev.checkpoint_record_no
                  AND mp_l.record_no <= v_cp_curr.checkpoint_record_no
                  AND m_l.match_date IS NOT NULL
                  AND m_l.match_date < v_cp_prev.checkpoint_at - INTERVAL '2 seconds'
              ) INTO v_has_late_pre;

              IF NOT v_has_late_pre THEN
                v_dw := v_cp_curr.win_count - v_cp_prev.win_count;
                v_dl := v_cp_curr.lose_count - v_cp_prev.lose_count;
                v_dd := v_cp_curr.draw_count - v_cp_prev.draw_count;

                SELECT
                  COUNT(*) FILTER (WHERE out_c = 'w')::int,
                  COUNT(*) FILTER (WHERE out_c = 'l')::int,
                  COUNT(*) FILTER (WHERE out_c = 'd')::int
                INTO v_int_w, v_int_l, v_int_d
                FROM (
                  SELECT
                    CASE
                      WHEN mp_i.is_winner THEN 'w'
                      WHEN EXISTS (
                        SELECT 1
                        FROM solare_match_players w_i
                        WHERE w_i.region = mp_i.region
                          AND w_i.record_no = mp_i.record_no
                          AND w_i.is_winner
                      ) THEN 'l'
                      ELSE 'd'
                    END AS out_c
                  FROM solare_match_players mp_i
                  LEFT JOIN solare_matches m_i
                    ON m_i.region = mp_i.region AND m_i.record_no = mp_i.record_no
                  LEFT JOIN solare_match_mode_proofs pr_i
                    ON pr_i.region = mp_i.region AND pr_i.record_no = mp_i.record_no
                  WHERE mp_i.region = p_region
                    AND mp_i.user_no = v_part.user_no
                    AND mp_i.record_no > v_cp_prev.checkpoint_record_no
                    AND mp_i.record_no <= v_cp_curr.checkpoint_record_no
                    AND COALESCE(pr_i.mode, '') <> 'practice'
                    AND (
                      m_i.record_no IS NULL
                      OR COALESCE(m_i.season, 9) = COALESCE(v_part.season, v_target_season)
                    )
                ) sub_i;

                IF v_int_w >= v_dw AND v_int_l >= v_dl AND v_int_d >= v_dd THEN
                  IF (v_part.outcome = 'w' AND v_int_w <= v_dw)
                     OR (v_part.outcome = 'l' AND v_int_l <= v_dl)
                     OR (v_part.outcome = 'd' AND v_int_d <= v_dd) THEN
                    RETURN TRUE;
                  END IF;
                END IF;
              END IF;
            END IF;
          END IF;
        END IF;

        SELECT
          COUNT(*) FILTER (WHERE out_s = 'w')::int,
          COUNT(*) FILTER (WHERE out_s = 'l')::int,
          COUNT(*) FILTER (WHERE out_s = 'd')::int
        INTO v_tot_w, v_tot_l, v_tot_d
        FROM (
          SELECT
            CASE
              WHEN mp_cnt.is_winner THEN 'w'
              WHEN EXISTS (
                SELECT 1
                FROM solare_match_players w_cnt
                WHERE w_cnt.region = mp_cnt.region
                  AND w_cnt.record_no = mp_cnt.record_no
                  AND w_cnt.is_winner
              ) THEN 'l'
              ELSE 'd'
            END AS out_s
          FROM solare_match_players mp_cnt
          LEFT JOIN solare_matches m_cnt
            ON m_cnt.region = mp_cnt.region AND m_cnt.record_no = mp_cnt.record_no
          LEFT JOIN solare_match_mode_proofs pr_cnt
            ON pr_cnt.region = mp_cnt.region AND pr_cnt.record_no = mp_cnt.record_no
          WHERE mp_cnt.region = p_region
            AND (
              (v_part.user_no IS NOT NULL AND mp_cnt.user_no = v_part.user_no)
              OR ((v_part.user_no IS NULL OR mp_cnt.user_no IS NULL) AND LOWER(mp_cnt.user_nickname) = LOWER(v_part.user_nickname))
            )
            AND COALESCE(pr_cnt.mode, '') <> 'practice'
            AND (
              m_cnt.record_no IS NULL
              OR COALESCE(m_cnt.season, 9) = COALESCE(v_part.season, v_target_season)
            )
        ) sub_s;

        IF v_tot_w >= COALESCE(v_part.win_count, 0)
           AND v_tot_l >= COALESCE(v_part.lose_count, 0)
           AND v_tot_d >= COALESCE(v_part.draw_count, 0) THEN
          IF (v_part.outcome = 'w' AND v_tot_w <= COALESCE(v_part.win_count, 0))
             OR (v_part.outcome = 'l' AND v_tot_l <= COALESCE(v_part.lose_count, 0))
             OR (v_part.outcome = 'd' AND v_tot_d <= COALESCE(v_part.draw_count, 0)) THEN
            RETURN TRUE;
          END IF;
        END IF;
      END LOOP;

      RETURN FALSE;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION fn_trg_solare_match_mode_proof_sync()
    RETURNS TRIGGER AS $$
    DECLARE
      v_ev RECORD;
      v_applied_delta INTEGER;
      v_epoch_id BIGINT;
      v_prev_record_no BIGINT;
      v_prev_at TIMESTAMPTZ;
      v_player_anchor BIGINT;
      v_player_season SMALLINT;
      v_player_last_seen TIMESTAMPTZ;
    BEGIN
      IF (TG_OP = 'INSERT' AND NEW.mode = 'practice')
         OR (TG_OP = 'UPDATE' AND NEW.mode = 'practice' AND OLD.mode IS DISTINCT FROM 'practice') THEN
        INSERT INTO solare_practice_suspect_matches (region, record_no, reason)
        VALUES (NEW.region, NEW.record_no, 'math_proof')
        ON CONFLICT (region, record_no) DO NOTHING;

        FOR v_ev IN
          DELETE FROM solare_player_rating_events
          WHERE region = NEW.region
            AND record_no = NEW.record_no
            AND event_type = 'match_delta'
          RETURNING id, season, user_no, previous_rating, new_rating, rating_delta
        LOOP
          v_applied_delta := COALESCE(
            v_ev.new_rating - v_ev.previous_rating,
            v_ev.rating_delta
          );

          SELECT MAX(e_ep.id)
          INTO v_epoch_id
          FROM solare_player_rating_events e_ep
          WHERE e_ep.region = NEW.region
            AND e_ep.user_no = v_ev.user_no
            AND e_ep.event_type IN ('seed_anchor', 'reconcile', 'season_reset');

          IF v_epoch_id IS NOT NULL AND v_epoch_id > v_ev.id THEN
            CONTINUE;
          END IF;

          SELECT
            sp.rating_anchor_record_no,
            sp.season,
            sp.last_seen_at
          INTO
            v_player_anchor,
            v_player_season,
            v_player_last_seen
          FROM solare_players sp
          WHERE sp.region = NEW.region
            AND sp.user_no = v_ev.user_no
          FOR UPDATE;

          IF NOT FOUND THEN
            CONTINUE;
          END IF;

          IF COALESCE(v_ev.season, 9) <> COALESCE(v_player_season, 9) THEN
            CONTINUE;
          END IF;

          SELECT MAX(e2.record_no)
          INTO v_prev_record_no
          FROM solare_player_rating_events e2
          WHERE e2.region = NEW.region
            AND e2.user_no = v_ev.user_no
            AND e2.record_no IS NOT NULL
            AND (v_epoch_id IS NULL OR e2.id >= v_epoch_id)
            AND COALESCE(e2.season, 9) = COALESCE(v_player_season, 9);

          v_prev_record_no := NULLIF(
            GREATEST(
              COALESCE(v_player_anchor, 0),
              COALESCE(v_prev_record_no, 0)
            ),
            0
          );

          v_prev_at := NULL;
          IF v_prev_record_no IS NOT NULL THEN
            SELECT COALESCE(m.match_date, m.crawled_at)
            INTO v_prev_at
            FROM solare_matches m
            WHERE m.region = NEW.region
              AND m.record_no = v_prev_record_no
            LIMIT 1;
          END IF;
          v_prev_at := COALESCE(v_prev_at, v_player_last_seen);

          UPDATE solare_players sp
          SET
            rank_rating = CASE
              WHEN sp.rank_rating IS NOT NULL
                   AND COALESCE(sp.rating_anchor_record_no, 0) < NEW.record_no
                THEN GREATEST(0, sp.rank_rating - v_applied_delta)
              ELSE sp.rank_rating
            END,
            rating_achieved_record_no = CASE
              WHEN sp.rating_achieved_record_no = NEW.record_no THEN v_prev_record_no
              ELSE sp.rating_achieved_record_no
            END,
            rating_achieved_at = CASE
              WHEN sp.rating_achieved_record_no = NEW.record_no THEN v_prev_at
              ELSE sp.rating_achieved_at
            END,
            updated_at = timezone('utc', now())
          WHERE sp.region = NEW.region
            AND sp.user_no = v_ev.user_no;
        END LOOP;
      ELSIF (TG_OP = 'DELETE' AND OLD.mode = 'practice')
         OR (TG_OP = 'UPDATE' AND OLD.mode = 'practice' AND NEW.mode = 'ranked') THEN
        IF TG_OP = 'UPDATE' AND NEW.mode = 'ranked' THEN
          DELETE FROM solare_practice_suspect_matches
          WHERE region = OLD.region
            AND record_no = OLD.record_no;
        ELSE
          DELETE FROM solare_practice_suspect_matches
          WHERE region = OLD.region
            AND record_no = OLD.record_no
            AND reason = 'math_proof';
        END IF;

        UPDATE solare_match_players
        SET vary_rank_rating = vary_rank_rating
        WHERE region = OLD.region
          AND record_no = OLD.record_no
          AND vary_rank_rating IS NOT NULL
          AND vary_rank_rating <> 0;
      ELSIF TG_OP = 'INSERT' AND NEW.mode = 'ranked' THEN
        DELETE FROM solare_practice_suspect_matches
        WHERE region = NEW.region
          AND record_no = NEW.record_no;
      END IF;

      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_solare_match_mode_proof_sync ON solare_match_mode_proofs;

    CREATE TRIGGER trg_solare_match_mode_proof_sync
    AFTER INSERT OR UPDATE OF mode OR DELETE
    ON solare_match_mode_proofs
    FOR EACH ROW
    EXECUTE FUNCTION fn_trg_solare_match_mode_proof_sync();
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_get_solare_monotonic_neighbor_bounds(
      p_region VARCHAR,
      p_user_no BIGINT,
      p_user_nickname VARCHAR,
      p_season SMALLINT,
      p_current_ranking INTEGER
    )
    RETURNS TABLE (
      upper_bound INTEGER,
      upper_rank INTEGER,
      lower_bound INTEGER,
      lower_rank INTEGER
    ) AS $$
    DECLARE
      v_target_season SMALLINT := COALESCE(p_season, 9)::smallint;
      v_up_a_rating INTEGER;
      v_up_a_rank INTEGER;
      v_low_b_rating INTEGER;
      v_low_b_rank INTEGER;
      v_low_a_rating INTEGER;
      v_low_a_rank INTEGER;
      v_up_b_rating INTEGER;
      v_up_b_rank INTEGER;
      v_gap_a INTEGER;
      v_gap_b INTEGER;
      v_span_a INTEGER;
      v_span_b INTEGER;
      v_tight_a BOOLEAN;
      v_tight_b BOOLEAN;
    BEGIN
      SELECT x.rank_rating, x.current_ranking
      INTO v_up_a_rating, v_up_a_rank
      FROM (
        SELECT DISTINCT ON (sp_up.current_ranking)
          sp_up.user_no,
          sp_up.user_nickname,
          sp_up.season,
          sp_up.current_ranking,
          sp_up.rank_rating,
          sp_up.rating_is_estimated,
          sp_up.last_seen_at
        FROM solare_players sp_up
        WHERE sp_up.region = p_region
          AND NOT (
            (p_user_no IS NOT NULL AND sp_up.user_no = p_user_no)
            OR (p_user_no IS NULL AND sp_up.user_no IS NULL AND LOWER(sp_up.user_nickname) = LOWER(COALESCE(p_user_nickname, '')))
          )
          AND sp_up.current_ranking IS NOT NULL
          AND sp_up.current_ranking < p_current_ranking
          AND (
            sp_up.season = v_target_season
            OR (v_target_season = 9 AND sp_up.season IS NULL)
          )
        ORDER BY
          sp_up.current_ranking DESC,
          sp_up.last_seen_at DESC NULLS LAST,
          sp_up.updated_at DESC NULLS LAST
      ) x
      WHERE x.rank_rating IS NOT NULL
        AND NOT COALESCE(x.rating_is_estimated, FALSE)
        AND (
          x.last_seen_at IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM solare_match_players mp_post
            INNER JOIN solare_matches m_post
              ON m_post.region = mp_post.region AND m_post.record_no = mp_post.record_no
            LEFT JOIN solare_match_mode_proofs pr_post
              ON pr_post.region = mp_post.region AND pr_post.record_no = mp_post.record_no
            WHERE mp_post.region = p_region
              AND COALESCE(pr_post.mode, '') <> 'practice'
              AND COALESCE(m_post.season, 9) = COALESCE(x.season, v_target_season)
              AND (
                (x.user_no IS NOT NULL AND mp_post.user_no = x.user_no)
                OR ((x.user_no IS NULL OR mp_post.user_no IS NULL) AND LOWER(mp_post.user_nickname) = LOWER(x.user_nickname))
              )
              AND m_post.match_date IS NOT NULL
              AND m_post.match_date > x.last_seen_at + INTERVAL '10 seconds'
          )
        )
      ORDER BY x.current_ranking DESC
      LIMIT 1;

      SELECT x.rank_rating, x.current_ranking
      INTO v_low_b_rating, v_low_b_rank
      FROM (
        SELECT DISTINCT ON (sp_low.current_ranking)
          sp_low.user_no,
          sp_low.user_nickname,
          sp_low.season,
          sp_low.current_ranking,
          sp_low.rank_rating,
          sp_low.rating_is_estimated,
          sp_low.last_seen_at
        FROM solare_players sp_low
        WHERE sp_low.region = p_region
          AND NOT (
            (p_user_no IS NOT NULL AND sp_low.user_no = p_user_no)
            OR (p_user_no IS NULL AND sp_low.user_no IS NULL AND LOWER(sp_low.user_nickname) = LOWER(COALESCE(p_user_nickname, '')))
          )
          AND sp_low.current_ranking IS NOT NULL
          AND sp_low.current_ranking > p_current_ranking
          AND (
            sp_low.season = v_target_season
            OR (v_target_season = 9 AND sp_low.season IS NULL)
          )
        ORDER BY
          sp_low.current_ranking ASC,
          sp_low.last_seen_at DESC NULLS LAST,
          sp_low.updated_at DESC NULLS LAST
      ) x
      WHERE x.rank_rating IS NOT NULL
        AND NOT COALESCE(x.rating_is_estimated, FALSE)
        AND (
          x.last_seen_at IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM solare_match_players mp_post
            INNER JOIN solare_matches m_post
              ON m_post.region = mp_post.region AND m_post.record_no = mp_post.record_no
            LEFT JOIN solare_match_mode_proofs pr_post
              ON pr_post.region = mp_post.region AND pr_post.record_no = mp_post.record_no
            WHERE mp_post.region = p_region
              AND COALESCE(pr_post.mode, '') <> 'practice'
              AND COALESCE(m_post.season, 9) = COALESCE(x.season, v_target_season)
              AND (
                (x.user_no IS NOT NULL AND mp_post.user_no = x.user_no)
                OR ((x.user_no IS NULL OR mp_post.user_no IS NULL) AND LOWER(mp_post.user_nickname) = LOWER(x.user_nickname))
              )
              AND m_post.match_date IS NOT NULL
              AND m_post.match_date > x.last_seen_at + INTERVAL '10 seconds'
          )
        )
      ORDER BY x.current_ranking ASC
      LIMIT 1;

      -- Fast path: immediate neighbors are already monotonic or one side is absent
      IF p_current_ranking = 1
         OR v_up_a_rating IS NULL
         OR v_low_b_rating IS NULL
         OR v_up_a_rating >= v_low_b_rating THEN
        RETURN QUERY SELECT v_up_a_rating, v_up_a_rank, v_low_b_rating, v_low_b_rank;
        RETURN;
      END IF;

      -- Slow path: immediate neighbors are inverted (v_up_a_rating < v_low_b_rating).
      -- Evaluate Candidate A (keep up_a, find nearest low_a <= up_a) and Candidate B (keep low_b, find nearest up_b >= low_b).
      SELECT x.rank_rating, x.current_ranking
      INTO v_low_a_rating, v_low_a_rank
      FROM (
        SELECT DISTINCT ON (sp_low.current_ranking)
          sp_low.user_no,
          sp_low.user_nickname,
          sp_low.season,
          sp_low.current_ranking,
          sp_low.rank_rating,
          sp_low.rating_is_estimated,
          sp_low.last_seen_at
        FROM solare_players sp_low
        WHERE sp_low.region = p_region
          AND NOT (
            (p_user_no IS NOT NULL AND sp_low.user_no = p_user_no)
            OR (p_user_no IS NULL AND sp_low.user_no IS NULL AND LOWER(sp_low.user_nickname) = LOWER(COALESCE(p_user_nickname, '')))
          )
          AND sp_low.current_ranking IS NOT NULL
          AND sp_low.current_ranking > v_low_b_rank
          AND (
            sp_low.season = v_target_season
            OR (v_target_season = 9 AND sp_low.season IS NULL)
          )
        ORDER BY
          sp_low.current_ranking ASC,
          sp_low.last_seen_at DESC NULLS LAST,
          sp_low.updated_at DESC NULLS LAST
      ) x
      WHERE x.rank_rating IS NOT NULL
        AND x.rank_rating <= v_up_a_rating
        AND NOT COALESCE(x.rating_is_estimated, FALSE)
        AND (
          x.last_seen_at IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM solare_match_players mp_post
            INNER JOIN solare_matches m_post
              ON m_post.region = mp_post.region AND m_post.record_no = mp_post.record_no
            LEFT JOIN solare_match_mode_proofs pr_post
              ON pr_post.region = mp_post.region AND pr_post.record_no = mp_post.record_no
            WHERE mp_post.region = p_region
              AND COALESCE(pr_post.mode, '') <> 'practice'
              AND COALESCE(m_post.season, 9) = COALESCE(x.season, v_target_season)
              AND (
                (x.user_no IS NOT NULL AND mp_post.user_no = x.user_no)
                OR ((x.user_no IS NULL OR mp_post.user_no IS NULL) AND LOWER(mp_post.user_nickname) = LOWER(x.user_nickname))
              )
              AND m_post.match_date IS NOT NULL
              AND m_post.match_date > x.last_seen_at + INTERVAL '10 seconds'
          )
        )
      ORDER BY x.current_ranking ASC
      LIMIT 1;

      SELECT x.rank_rating, x.current_ranking
      INTO v_up_b_rating, v_up_b_rank
      FROM (
        SELECT DISTINCT ON (sp_up.current_ranking)
          sp_up.user_no,
          sp_up.user_nickname,
          sp_up.season,
          sp_up.current_ranking,
          sp_up.rank_rating,
          sp_up.rating_is_estimated,
          sp_up.last_seen_at
        FROM solare_players sp_up
        WHERE sp_up.region = p_region
          AND NOT (
            (p_user_no IS NOT NULL AND sp_up.user_no = p_user_no)
            OR (p_user_no IS NULL AND sp_up.user_no IS NULL AND LOWER(sp_up.user_nickname) = LOWER(COALESCE(p_user_nickname, '')))
          )
          AND sp_up.current_ranking IS NOT NULL
          AND sp_up.current_ranking < v_up_a_rank
          AND (
            sp_up.season = v_target_season
            OR (v_target_season = 9 AND sp_up.season IS NULL)
          )
        ORDER BY
          sp_up.current_ranking DESC,
          sp_up.last_seen_at DESC NULLS LAST,
          sp_up.updated_at DESC NULLS LAST
      ) x
      WHERE x.rank_rating IS NOT NULL
        AND x.rank_rating >= v_low_b_rating
        AND NOT COALESCE(x.rating_is_estimated, FALSE)
        AND (
          x.last_seen_at IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM solare_match_players mp_post
            INNER JOIN solare_matches m_post
              ON m_post.region = mp_post.region AND m_post.record_no = mp_post.record_no
            LEFT JOIN solare_match_mode_proofs pr_post
              ON pr_post.region = mp_post.region AND pr_post.record_no = mp_post.record_no
            WHERE mp_post.region = p_region
              AND COALESCE(pr_post.mode, '') <> 'practice'
              AND COALESCE(m_post.season, 9) = COALESCE(x.season, v_target_season)
              AND (
                (x.user_no IS NOT NULL AND mp_post.user_no = x.user_no)
                OR ((x.user_no IS NULL OR mp_post.user_no IS NULL) AND LOWER(mp_post.user_nickname) = LOWER(x.user_nickname))
              )
              AND m_post.match_date IS NOT NULL
              AND m_post.match_date > x.last_seen_at + INTERVAL '10 seconds'
          )
        )
      ORDER BY x.current_ranking DESC
      LIMIT 1;

      IF v_low_a_rating IS NOT NULL AND v_up_b_rating IS NOT NULL THEN
        v_gap_a := v_up_a_rating - v_low_a_rating;
        v_gap_b := v_up_b_rating - v_low_b_rating;
        v_tight_a := v_gap_a <= 40;
        v_tight_b := v_gap_b <= 40;
        v_span_a := v_low_a_rank - v_up_a_rank;
        v_span_b := v_low_b_rank - v_up_b_rank;

        IF (v_tight_a AND NOT v_tight_b)
           OR (v_tight_a = v_tight_b AND v_span_a < v_span_b)
           OR (v_tight_a = v_tight_b AND v_span_a = v_span_b AND v_gap_a <= v_gap_b) THEN
          RETURN QUERY SELECT v_up_a_rating, v_up_a_rank, v_low_a_rating, v_low_a_rank;
        ELSE
          RETURN QUERY SELECT v_up_b_rating, v_up_b_rank, v_low_b_rating, v_low_b_rank;
        END IF;
        RETURN;
      ELSIF v_low_a_rating IS NOT NULL THEN
        RETURN QUERY SELECT v_up_a_rating, v_up_a_rank, v_low_a_rating, v_low_a_rank;
        RETURN;
      ELSIF v_up_b_rating IS NOT NULL THEN
        RETURN QUERY SELECT v_up_b_rating, v_up_b_rank, v_low_b_rating, v_low_b_rank;
        RETURN;
      END IF;

      RETURN QUERY SELECT v_up_a_rating, v_up_a_rank, v_low_b_rating, v_low_b_rank;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_process_solare_player_wl_checkpoint(
      p_region VARCHAR,
      p_user_no BIGINT
    )
    RETURNS BOOLEAN AS $$
    DECLARE
      v_player RECORD;
      v_season SMALLINT;
      v_snap_at TIMESTAMPTZ;
      v_has_prior_cp BOOLEAN;
      v_latest_cp_at TIMESTAMPTZ;
      v_curr_max_rn BIGINT;
      v_cp_prev RECORD;
      v_cp_prev2 RECORD;
      v_has_late_pre BOOLEAN;
      v_dw INTEGER;
      v_dl INTEGER;
      v_dd INTEGER;
      v_raw_stats RECORD;
      v_win_stats RECORD;
      v_rem_w INTEGER;
      v_rem_l INTEGER;
      v_rem_d INTEGER;
      v_rem_total INTEGER;
      v_cand_rec RECORD;
      v_upper_bound INTEGER;
      v_lower_bound INTEGER;
      v_comb_w BIGINT;
      v_comb_l BIGINT;
      v_comb_d BIGINT;
      v_combo_res RECORD;
      v_rn BIGINT;
      v_mutated BOOLEAN := FALSE;
    BEGIN
      IF p_user_no IS NULL THEN
        RETURN FALSE;
      END IF;

      SELECT
        region,
        user_no,
        user_nickname,
        season,
        current_ranking,
        rank_rating,
        rating_is_estimated,
        rating_anchor_record_no,
        win_count,
        lose_count,
        draw_count,
        last_seen_at
      INTO v_player
      FROM solare_players
      WHERE region = p_region
        AND user_no = p_user_no
      ORDER BY updated_at DESC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND
         OR v_player.current_ranking IS NULL
         OR v_player.current_ranking < 1
         OR v_player.win_count IS NULL
         OR v_player.lose_count IS NULL THEN
        RETURN FALSE;
      END IF;

      v_season := COALESCE(v_player.season, 9);
      v_snap_at := COALESCE(v_player.last_seen_at, timezone('utc', now()));

      -- Clear checkpoints from previous seasons or after an official counter reset
      DELETE FROM solare_player_wl_checkpoints
      WHERE region = v_player.region
        AND user_no = v_player.user_no
        AND (
          season <> v_season
          OR win_count > COALESCE(v_player.win_count, 0)
          OR lose_count > COALESCE(v_player.lose_count, 0)
          OR draw_count > COALESCE(v_player.draw_count, 0)
        );

      SELECT
        COUNT(*) > 0,
        MAX(checkpoint_at)
      INTO
        v_has_prior_cp,
        v_latest_cp_at
      FROM solare_player_wl_checkpoints
      WHERE region = v_player.region
        AND user_no = v_player.user_no
        AND season = v_season;

      -- Require strict causal synchronization for incremental updates (match_date <= last_seen_at),
      -- and 10s tolerance only when recording the initial baseline checkpoint.
      IF EXISTS (
        SELECT 1
        FROM solare_match_players mp_post
        INNER JOIN solare_matches m_post
          ON m_post.region = mp_post.region AND m_post.record_no = mp_post.record_no
        LEFT JOIN solare_match_mode_proofs pr_post
          ON pr_post.region = mp_post.region AND pr_post.record_no = mp_post.record_no
        WHERE mp_post.region = v_player.region
          AND COALESCE(pr_post.mode, '') <> 'practice'
          AND (
            mp_post.user_no = v_player.user_no
            OR (mp_post.user_no IS NULL AND LOWER(mp_post.user_nickname) = LOWER(v_player.user_nickname))
          )
          AND COALESCE(m_post.season, 9) = v_season
          AND m_post.match_date IS NOT NULL
          AND m_post.match_date > (
            CASE
              WHEN v_has_prior_cp THEN v_snap_at
              ELSE v_snap_at + INTERVAL '10 seconds'
            END
          )
      ) THEN
        RETURN FALSE;
      END IF;

      SELECT GREATEST(
        COALESCE(MAX(mp.record_no), 0),
        COALESCE(v_player.rating_anchor_record_no, 0)
      )
      INTO v_curr_max_rn
      FROM solare_match_players mp
      LEFT JOIN solare_matches m
        ON m.region = mp.region AND m.record_no = mp.record_no
      WHERE mp.region = v_player.region
        AND (
          mp.user_no = v_player.user_no
          OR (mp.user_no IS NULL AND LOWER(mp.user_nickname) = LOWER(v_player.user_nickname))
        )
        AND (
          m.record_no IS NULL
          OR COALESCE(m.season, 9) = v_season
        );

      INSERT INTO solare_player_wl_checkpoints (
        region,
        user_no,
        season,
        checkpoint_record_no,
        checkpoint_at,
        win_count,
        lose_count,
        draw_count,
        checkpoint_rating,
        checkpoint_rating_is_estimated,
        updated_at
      )
      VALUES (
        v_player.region,
        v_player.user_no,
        v_season,
        v_curr_max_rn,
        v_snap_at,
        COALESCE(v_player.win_count, 0),
        COALESCE(v_player.lose_count, 0),
        COALESCE(v_player.draw_count, 0),
        v_player.rank_rating,
        COALESCE(v_player.rating_is_estimated, FALSE),
        timezone('utc', now())
      )
      ON CONFLICT (region, user_no, season, checkpoint_record_no) DO UPDATE
      SET
        checkpoint_at = EXCLUDED.checkpoint_at,
        win_count = EXCLUDED.win_count,
        lose_count = EXCLUDED.lose_count,
        draw_count = EXCLUDED.draw_count,
        checkpoint_rating = EXCLUDED.checkpoint_rating,
        checkpoint_rating_is_estimated = EXCLUDED.checkpoint_rating_is_estimated,
        updated_at = timezone('utc', now());

      LOOP
        SELECT *
        INTO v_cp_prev
        FROM solare_player_wl_checkpoints
        WHERE region = v_player.region
          AND user_no = v_player.user_no
          AND season = v_season
          AND checkpoint_record_no < v_curr_max_rn
        ORDER BY checkpoint_record_no DESC
        LIMIT 1;

        IF NOT FOUND THEN
          RETURN v_mutated;
        END IF;

        -- Guard against pre-checkpoint matches that were crawled after the previous checkpoint timestamp
        SELECT EXISTS (
          SELECT 1
          FROM solare_match_players mp_l
          INNER JOIN solare_matches m_l
            ON m_l.region = mp_l.region AND m_l.record_no = mp_l.record_no
          WHERE mp_l.region = v_player.region
            AND (
              mp_l.user_no = v_player.user_no
              OR (mp_l.user_no IS NULL AND LOWER(mp_l.user_nickname) = LOWER(v_player.user_nickname))
            )
            AND mp_l.record_no > v_cp_prev.checkpoint_record_no
            AND mp_l.record_no <= v_curr_max_rn
            AND m_l.match_date IS NOT NULL
            AND m_l.match_date < v_cp_prev.checkpoint_at - INTERVAL '2 seconds'
        ) INTO v_has_late_pre;

        IF v_has_late_pre THEN
          RETURN v_mutated;
        END IF;

        v_dw := COALESCE(v_player.win_count, 0) - v_cp_prev.win_count;
        v_dl := COALESCE(v_player.lose_count, 0) - v_cp_prev.lose_count;
        v_dd := COALESCE(v_player.draw_count, 0) - v_cp_prev.draw_count;

        SELECT
          COUNT(*) FILTER (WHERE out_r = 'w')::int AS raw_w,
          COUNT(*) FILTER (WHERE out_r = 'l')::int AS raw_l,
          COUNT(*) FILTER (WHERE out_r = 'd')::int AS raw_d,
          COUNT(*) FILTER (WHERE NOT is_cp_prac AND out_r = 'w')::int AS non_prac_w,
          COUNT(*) FILTER (WHERE NOT is_cp_prac AND out_r = 'l')::int AS non_prac_l,
          COUNT(*) FILTER (WHERE NOT is_cp_prac AND out_r = 'd')::int AS non_prac_d
        INTO v_raw_stats
        FROM (
          SELECT
            CASE
              WHEN mp.is_winner THEN 'w'
              WHEN EXISTS (
                SELECT 1
                FROM solare_match_players w
                WHERE w.region = mp.region
                  AND w.record_no = mp.record_no
                  AND w.is_winner
              ) THEN 'l'
              ELSE 'd'
            END AS out_r,
            (COALESCE(pr.mode, '') = 'practice') AS is_cp_prac
          FROM solare_match_players mp
          LEFT JOIN solare_matches m
            ON m.region = mp.region AND m.record_no = mp.record_no
          LEFT JOIN solare_match_mode_proofs pr
            ON pr.region = mp.region AND pr.record_no = mp.record_no
          WHERE mp.region = v_player.region
            AND mp.record_no > v_cp_prev.checkpoint_record_no
            AND mp.record_no <= v_curr_max_rn
            AND NOT (
              COALESCE(pr.mode, '') = 'practice'
              AND COALESCE(pr.method, '') NOT IN ('checkpoint_wl_delta', 'checkpoint_math')
            )
            AND (
              mp.user_no = v_player.user_no
              OR (mp.user_no IS NULL AND LOWER(mp.user_nickname) = LOWER(v_player.user_nickname))
            )
            AND (
              m.record_no IS NULL
              OR COALESCE(m.season, 9) = v_season
            )
        ) r_sub;

        IF v_raw_stats.raw_w < v_dw OR v_raw_stats.raw_l < v_dl OR v_raw_stats.raw_d < v_dd THEN
          SELECT *
          INTO v_cp_prev2
          FROM solare_player_wl_checkpoints
          WHERE region = v_player.region
            AND user_no = v_player.user_no
            AND season = v_season
            AND checkpoint_record_no < v_cp_prev.checkpoint_record_no
          ORDER BY checkpoint_record_no DESC
          LIMIT 1;

          IF FOUND AND EXISTS (
            SELECT 1
            FROM solare_match_mode_proofs pr_p
            INNER JOIN solare_match_players mp_p
              ON mp_p.region = pr_p.region AND mp_p.record_no = pr_p.record_no
            WHERE pr_p.region = v_player.region
              AND pr_p.record_no > v_cp_prev2.checkpoint_record_no
              AND pr_p.record_no <= v_cp_prev.checkpoint_record_no
              AND pr_p.mode = 'practice'
              AND pr_p.method IN ('checkpoint_wl_delta', 'checkpoint_math')
              AND (
                mp_p.user_no = v_player.user_no
                OR (mp_p.user_no IS NULL AND LOWER(mp_p.user_nickname) = LOWER(v_player.user_nickname))
              )
              AND (
                (mp_p.is_winner AND v_raw_stats.raw_w < v_dw)
                OR (
                  NOT mp_p.is_winner
                  AND EXISTS (
                    SELECT 1
                    FROM solare_match_players w_p
                    WHERE w_p.region = mp_p.region
                      AND w_p.record_no = mp_p.record_no
                      AND w_p.is_winner
                  )
                  AND v_raw_stats.raw_l < v_dl
                )
                OR (
                  NOT EXISTS (
                    SELECT 1
                    FROM solare_match_players w_p2
                    WHERE w_p2.region = mp_p.region
                      AND w_p2.record_no = mp_p.record_no
                      AND w_p2.is_winner
                  )
                  AND v_raw_stats.raw_d < v_dd
                )
              )
          ) THEN
            DELETE FROM solare_player_wl_checkpoints
            WHERE region = v_player.region
              AND user_no = v_player.user_no
              AND season = v_season
              AND checkpoint_record_no = v_cp_prev.checkpoint_record_no;

            v_mutated := TRUE;
            CONTINUE;
          END IF;
        END IF;

        EXIT;
      END LOOP;

      IF v_raw_stats.raw_w <= v_dw
         OR v_raw_stats.non_prac_w < v_dw
         OR v_raw_stats.raw_l <= v_dl
         OR v_raw_stats.non_prac_l < v_dl
         OR v_raw_stats.raw_d <= v_dd
         OR v_raw_stats.non_prac_d < v_dd THEN
        FOR v_rn IN
          DELETE FROM solare_match_mode_proofs pr_del
          USING solare_match_players mp_del
          WHERE pr_del.region = v_player.region
            AND mp_del.region = pr_del.region
            AND mp_del.record_no = pr_del.record_no
            AND pr_del.record_no > v_cp_prev.checkpoint_record_no
            AND pr_del.record_no <= v_curr_max_rn
            AND pr_del.method IN ('checkpoint_wl_delta', 'checkpoint_math')
            AND (
              mp_del.user_no = v_player.user_no
              OR (mp_del.user_no IS NULL AND LOWER(mp_del.user_nickname) = LOWER(v_player.user_nickname))
            )
            AND (
              (mp_del.is_winner AND (v_raw_stats.raw_w <= v_dw OR v_raw_stats.non_prac_w < v_dw))
              OR (
                NOT mp_del.is_winner
                AND EXISTS (
                  SELECT 1
                  FROM solare_match_players w_d
                  WHERE w_d.region = mp_del.region
                    AND w_d.record_no = mp_del.record_no
                    AND w_d.is_winner
                )
                AND (v_raw_stats.raw_l <= v_dl OR v_raw_stats.non_prac_l < v_dl)
              )
              OR (
                NOT EXISTS (
                  SELECT 1
                  FROM solare_match_players w_d2
                  WHERE w_d2.region = mp_del.region
                    AND w_d2.record_no = mp_del.record_no
                    AND w_d2.is_winner
                )
                AND (v_raw_stats.raw_d <= v_dd OR v_raw_stats.non_prac_d < v_dd)
              )
            )
          RETURNING pr_del.record_no
        LOOP
          v_mutated := TRUE;
        END LOOP;
      END IF;

      -- 1. Deterministic pigeonhole proof per outcome when remaining official Ranked slots in the window == 0
      WITH win_matches AS (
        SELECT
          mp.record_no,
          NULLIF(TRIM(m.repz_download_url), '') IS NOT NULL AS has_repz,
          CASE
            WHEN mp.is_winner THEN 'w'
            WHEN EXISTS (
              SELECT 1
              FROM solare_match_players w
              WHERE w.region = mp.region
                AND w.record_no = mp.record_no
                AND w.is_winner
            ) THEN 'l'
            ELSE 'd'
          END AS outcome,
          (pr.mode = 'practice') IS TRUE AS is_prac,
          (pr.mode = 'ranked') IS TRUE AS is_ranked
        FROM solare_match_players mp
        LEFT JOIN solare_matches m
          ON m.region = mp.region AND m.record_no = mp.record_no
        LEFT JOIN solare_match_mode_proofs pr
          ON pr.region = mp.region AND pr.record_no = mp.record_no
        WHERE mp.region = v_player.region
          AND mp.record_no > v_cp_prev.checkpoint_record_no
          AND mp.record_no <= v_curr_max_rn
          AND (
            mp.user_no = v_player.user_no
            OR (mp.user_no IS NULL AND LOWER(mp.user_nickname) = LOWER(v_player.user_nickname))
          )
          AND (
            m.record_no IS NULL
            OR COALESCE(m.season, 9) = v_season
          )
      )
      SELECT
        COUNT(*) FILTER (WHERE NOT is_prac AND outcome = 'w')::int AS non_prac_w,
        COUNT(*) FILTER (WHERE NOT is_prac AND outcome = 'l')::int AS non_prac_l,
        COUNT(*) FILTER (WHERE NOT is_prac AND outcome = 'd')::int AS non_prac_d,
        COUNT(*) FILTER (WHERE NOT is_prac AND NOT is_ranked AND NOT has_repz AND outcome = 'w')::int AS cand_w,
        COUNT(*) FILTER (WHERE NOT is_prac AND NOT is_ranked AND NOT has_repz AND outcome = 'l')::int AS cand_l,
        COUNT(*) FILTER (WHERE NOT is_prac AND NOT is_ranked AND NOT has_repz AND outcome = 'd')::int AS cand_d
      INTO v_win_stats
      FROM win_matches;

      v_rem_w := v_win_stats.non_prac_w - v_dw;
      v_rem_l := v_win_stats.non_prac_l - v_dl;
      v_rem_d := v_win_stats.non_prac_d - v_dd;

      IF (v_dw >= 0 AND v_rem_w > 0 AND v_win_stats.cand_w = v_rem_w)
         OR (v_dl >= 0 AND v_rem_l > 0 AND v_win_stats.cand_l = v_rem_l)
         OR (v_dd >= 0 AND v_rem_d > 0 AND v_win_stats.cand_d = v_rem_d) THEN
        FOR v_cand_rec IN
          SELECT
            mp.record_no,
            CASE
              WHEN mp.is_winner THEN 'w'
              WHEN EXISTS (
                SELECT 1
                FROM solare_match_players w
                WHERE w.region = mp.region
                  AND w.record_no = mp.record_no
                  AND w.is_winner
              ) THEN 'l'
              ELSE 'd'
            END AS outcome
          FROM solare_match_players mp
          LEFT JOIN solare_matches m
            ON m.region = mp.region AND m.record_no = mp.record_no
          LEFT JOIN solare_match_mode_proofs pr
            ON pr.region = mp.region AND pr.record_no = mp.record_no
          WHERE mp.region = v_player.region
            AND mp.record_no > v_cp_prev.checkpoint_record_no
            AND mp.record_no <= v_curr_max_rn
            AND COALESCE(pr.mode, '') NOT IN ('practice', 'ranked')
            AND NULLIF(TRIM(m.repz_download_url), '') IS NULL
            AND (
              mp.user_no = v_player.user_no
              OR (mp.user_no IS NULL AND LOWER(mp.user_nickname) = LOWER(v_player.user_nickname))
            )
            AND (
              m.record_no IS NULL
              OR COALESCE(m.season, 9) = v_season
            )
          ORDER BY mp.record_no ASC
        LOOP
          IF (
               (v_cand_rec.outcome = 'w' AND v_dw >= 0 AND v_rem_w > 0 AND v_win_stats.cand_w = v_rem_w)
               OR (v_cand_rec.outcome = 'l' AND v_dl >= 0 AND v_rem_l > 0 AND v_win_stats.cand_l = v_rem_l)
               OR (v_cand_rec.outcome = 'd' AND v_dd >= 0 AND v_rem_d > 0 AND v_win_stats.cand_d = v_rem_d)
             )
             AND NOT fn_is_solare_practice_contradicted(
               v_player.region,
               v_cand_rec.record_no,
               v_player.user_no,
               v_player.user_nickname,
               v_season
             ) THEN
            INSERT INTO solare_match_mode_proofs (region, record_no, mode, method)
            VALUES (v_player.region, v_cand_rec.record_no, 'practice', 'checkpoint_wl_delta')
            ON CONFLICT (region, record_no) DO NOTHING;

            v_mutated := TRUE;
          END IF;
        END LOOP;
      END IF;

      -- 2. Combinatorial checkpoint rating solver when mixed Practice + Ranked games share the same window
      WITH win_matches_after AS (
        SELECT
          mp.record_no,
          mp.vary_rank_rating,
          NULLIF(TRIM(m.repz_download_url), '') IS NOT NULL AS has_repz,
          CASE
            WHEN mp.is_winner THEN 'w'
            WHEN EXISTS (
              SELECT 1
              FROM solare_match_players w
              WHERE w.region = mp.region
                AND w.record_no = mp.record_no
                AND w.is_winner
            ) THEN 'l'
            ELSE 'd'
          END AS outcome,
          (pr.mode = 'practice') IS TRUE AS is_prac,
          (pr.mode = 'ranked') IS TRUE AS is_ranked
        FROM solare_match_players mp
        LEFT JOIN solare_matches m
          ON m.region = mp.region AND m.record_no = mp.record_no
        LEFT JOIN solare_match_mode_proofs pr
          ON pr.region = mp.region AND pr.record_no = mp.record_no
        WHERE mp.region = v_player.region
          AND mp.record_no > v_cp_prev.checkpoint_record_no
          AND mp.record_no <= v_curr_max_rn
          AND (
            mp.user_no = v_player.user_no
            OR (mp.user_no IS NULL AND LOWER(mp.user_nickname) = LOWER(v_player.user_nickname))
          )
          AND (
            m.record_no IS NULL
            OR COALESCE(m.season, 9) = v_season
          )
      )
      SELECT
        COUNT(*) FILTER (WHERE NOT is_prac AND outcome = 'w')::int AS non_prac_w,
        COUNT(*) FILTER (WHERE NOT is_prac AND outcome = 'l')::int AS non_prac_l,
        COUNT(*) FILTER (WHERE NOT is_prac AND outcome = 'd')::int AS non_prac_d,
        COUNT(*) FILTER (WHERE NOT is_prac AND NOT is_ranked AND NOT has_repz AND outcome = 'w')::int AS cand_w,
        COUNT(*) FILTER (WHERE NOT is_prac AND NOT is_ranked AND NOT has_repz AND outcome = 'l')::int AS cand_l,
        COUNT(*) FILTER (WHERE NOT is_prac AND NOT is_ranked AND NOT has_repz AND outcome = 'd')::int AS cand_d,
        COUNT(*) FILTER (WHERE NOT is_prac AND vary_rank_rating IS NULL)::int AS null_pdl_count,
        COALESCE(SUM(vary_rank_rating) FILTER (WHERE NOT is_prac AND vary_rank_rating IS NOT NULL), 0)::int AS non_prac_delta
      INTO v_win_stats
      FROM win_matches_after;

      v_rem_w := v_win_stats.non_prac_w - v_dw;
      v_rem_l := v_win_stats.non_prac_l - v_dl;
      v_rem_d := v_win_stats.non_prac_d - v_dd;
      v_rem_total := v_rem_w + v_rem_l + v_rem_d;

      IF v_rem_w >= 0
         AND v_rem_l >= 0
         AND v_rem_d >= 0
         AND v_rem_total BETWEEN 1 AND 4
         AND v_win_stats.null_pdl_count = 0
         AND v_win_stats.cand_w >= v_rem_w
         AND v_win_stats.cand_l >= v_rem_l
         AND v_win_stats.cand_d >= v_rem_d
         AND v_cp_prev.checkpoint_rating IS NOT NULL
         AND NOT COALESCE(v_cp_prev.checkpoint_rating_is_estimated, FALSE) THEN

        SELECT
          b.upper_bound,
          b.lower_bound
        INTO
          v_upper_bound,
          v_lower_bound
        FROM fn_get_solare_monotonic_neighbor_bounds(
          v_player.region,
          v_player.user_no,
          v_player.user_nickname,
          v_season,
          v_player.current_ranking
        ) b;

        IF v_lower_bound IS NOT NULL
           AND (v_player.current_ranking = 1 OR (v_upper_bound IS NOT NULL AND v_upper_bound >= v_lower_bound)) THEN
          v_comb_w := CASE v_rem_w
            WHEN 0 THEN 1
            WHEN 1 THEN v_win_stats.cand_w
            WHEN 2 THEN (v_win_stats.cand_w::bigint * (v_win_stats.cand_w - 1)) / 2
            WHEN 3 THEN (v_win_stats.cand_w::bigint * (v_win_stats.cand_w - 1) * (v_win_stats.cand_w - 2)) / 6
            ELSE (v_win_stats.cand_w::bigint * (v_win_stats.cand_w - 1) * (v_win_stats.cand_w - 2) * (v_win_stats.cand_w - 3)) / 24
          END;
          v_comb_l := CASE v_rem_l
            WHEN 0 THEN 1
            WHEN 1 THEN v_win_stats.cand_l
            WHEN 2 THEN (v_win_stats.cand_l::bigint * (v_win_stats.cand_l - 1)) / 2
            WHEN 3 THEN (v_win_stats.cand_l::bigint * (v_win_stats.cand_l - 1) * (v_win_stats.cand_l - 2)) / 6
            ELSE (v_win_stats.cand_l::bigint * (v_win_stats.cand_l - 1) * (v_win_stats.cand_l - 2) * (v_win_stats.cand_l - 3)) / 24
          END;
          v_comb_d := CASE v_rem_d
            WHEN 0 THEN 1
            WHEN 1 THEN v_win_stats.cand_d
            WHEN 2 THEN (v_win_stats.cand_d::bigint * (v_win_stats.cand_d - 1)) / 2
            WHEN 3 THEN (v_win_stats.cand_d::bigint * (v_win_stats.cand_d - 1) * (v_win_stats.cand_d - 2)) / 6
            ELSE (v_win_stats.cand_d::bigint * (v_win_stats.cand_d - 1) * (v_win_stats.cand_d - 2) * (v_win_stats.cand_d - 3)) / 24
          END;

          IF (v_comb_w * v_comb_l * v_comb_d) BETWEEN 1 AND 5000 THEN
            WITH RECURSIVE
            win_cand AS (
              SELECT
                mp.record_no,
                mp.vary_rank_rating::int AS v,
                CASE
                  WHEN mp.is_winner THEN 'w'
                  WHEN EXISTS (
                    SELECT 1
                    FROM solare_match_players w
                    WHERE w.region = mp.region
                      AND w.record_no = mp.record_no
                      AND w.is_winner
                  ) THEN 'l'
                  ELSE 'd'
                END AS outcome,
                fn_is_solare_practice_contradicted(
                  v_player.region,
                  mp.record_no,
                  v_player.user_no,
                  v_player.user_nickname,
                  v_season
                ) AS is_contradicted
              FROM solare_match_players mp
              LEFT JOIN solare_matches m
                ON m.region = mp.region AND m.record_no = mp.record_no
              LEFT JOIN solare_match_mode_proofs pr
                ON pr.region = mp.region AND pr.record_no = mp.record_no
              WHERE mp.region = v_player.region
                AND mp.record_no > v_cp_prev.checkpoint_record_no
                AND mp.record_no <= v_curr_max_rn
                AND COALESCE(pr.mode, '') NOT IN ('practice', 'ranked')
                AND NULLIF(TRIM(m.repz_download_url), '') IS NULL
                AND (
                  mp.user_no = v_player.user_no
                  OR (mp.user_no IS NULL AND LOWER(mp.user_nickname) = LOWER(v_player.user_nickname))
                )
                AND (
                  m.record_no IS NULL
                  OR COALESCE(m.season, 9) = v_season
                )
            ),
            cand_w AS (
              SELECT ROW_NUMBER() OVER (ORDER BY record_no)::int AS idx, record_no, v, is_contradicted
              FROM win_cand
              WHERE outcome = 'w' AND v_rem_w > 0
            ),
            comb_w(last_idx, depth, rns, sum_v, has_contra) AS (
              SELECT 0, 0, ARRAY[]::bigint[], 0, FALSE
              UNION ALL
              SELECT cw.idx, c.depth + 1, c.rns || cw.record_no, c.sum_v + cw.v, (c.has_contra OR cw.is_contradicted)
              FROM comb_w c
              INNER JOIN cand_w cw ON cw.idx > c.last_idx
              WHERE c.depth < v_rem_w
            ),
            cand_l AS (
              SELECT ROW_NUMBER() OVER (ORDER BY record_no)::int AS idx, record_no, v, is_contradicted
              FROM win_cand
              WHERE outcome = 'l' AND v_rem_l > 0
            ),
            comb_l(last_idx, depth, rns, sum_v, has_contra) AS (
              SELECT 0, 0, ARRAY[]::bigint[], 0, FALSE
              UNION ALL
              SELECT cl.idx, c.depth + 1, c.rns || cl.record_no, c.sum_v + cl.v, (c.has_contra OR cl.is_contradicted)
              FROM comb_l c
              INNER JOIN cand_l cl ON cl.idx > c.last_idx
              WHERE c.depth < v_rem_l
            ),
            cand_d AS (
              SELECT ROW_NUMBER() OVER (ORDER BY record_no)::int AS idx, record_no, v, is_contradicted
              FROM win_cand
              WHERE outcome = 'd' AND v_rem_d > 0
            ),
            comb_d(last_idx, depth, rns, sum_v, has_contra) AS (
              SELECT 0, 0, ARRAY[]::bigint[], 0, FALSE
              UNION ALL
              SELECT cd.idx, c.depth + 1, c.rns || cd.record_no, c.sum_v + cd.v, (c.has_contra OR cd.is_contradicted)
              FROM comb_d c
              INNER JOIN cand_d cd ON cd.idx > c.last_idx
              WHERE c.depth < v_rem_d
            ),
            valid_combos AS (
              SELECT
                (vw.rns || vl.rns || vd.rns) AS excl_rns,
                (vw.has_contra OR vl.has_contra OR vd.has_contra) AS has_contra
              FROM (SELECT rns, sum_v, has_contra FROM comb_w WHERE depth = v_rem_w) vw
              CROSS JOIN (SELECT rns, sum_v, has_contra FROM comb_l WHERE depth = v_rem_l) vl
              CROSS JOIN (SELECT rns, sum_v, has_contra FROM comb_d WHERE depth = v_rem_d) vd
              WHERE GREATEST(0, v_cp_prev.checkpoint_rating + (v_win_stats.non_prac_delta - vw.sum_v - vl.sum_v - vd.sum_v)) >= v_lower_bound
                AND (
                  v_upper_bound IS NULL
                  OR GREATEST(0, v_cp_prev.checkpoint_rating + (v_win_stats.non_prac_delta - vw.sum_v - vl.sum_v - vd.sum_v)) <= v_upper_bound
                )
            ),
            combo_summary AS (
              SELECT
                COUNT(*)::int AS valid_count,
                COUNT(*) FILTER (WHERE NOT has_contra)::int AS uncontradicted_valid_count
              FROM valid_combos
            ),
            mandatory_prac AS (
              SELECT x.rn
              FROM valid_combos vc
              CROSS JOIN LATERAL unnest(vc.excl_rns) AS x(rn)
              CROSS JOIN combo_summary cs
              WHERE cs.valid_count > 0
              GROUP BY x.rn, cs.valid_count
              HAVING COUNT(*) = cs.valid_count
            ),
            mandatory_ranked AS (
              SELECT wc.record_no AS rn
              FROM win_cand wc
              CROSS JOIN combo_summary cs
              WHERE cs.valid_count > 0
                AND NOT EXISTS (
                  SELECT 1
                  FROM valid_combos vc
                  WHERE wc.record_no = ANY(vc.excl_rns)
                )
            )
            SELECT
              cs.valid_count,
              cs.uncontradicted_valid_count,
              COALESCE((SELECT ARRAY_AGG(rn ORDER BY rn) FROM mandatory_prac), ARRAY[]::bigint[]) AS prac_rns,
              COALESCE((SELECT ARRAY_AGG(rn ORDER BY rn) FROM mandatory_ranked), ARRAY[]::bigint[]) AS ranked_rns
            INTO v_combo_res
            FROM combo_summary cs;

            IF v_combo_res.valid_count > 0 AND v_combo_res.uncontradicted_valid_count > 0 THEN
              FOREACH v_rn IN ARRAY v_combo_res.prac_rns
              LOOP
                INSERT INTO solare_match_mode_proofs (region, record_no, mode, method)
                VALUES (v_player.region, v_rn, 'practice', 'checkpoint_math')
                ON CONFLICT (region, record_no) DO NOTHING;

                v_mutated := TRUE;
              END LOOP;

              FOREACH v_rn IN ARRAY v_combo_res.ranked_rns
              LOOP
                INSERT INTO solare_match_mode_proofs (region, record_no, mode, method)
                VALUES (v_player.region, v_rn, 'ranked', 'checkpoint_math')
                ON CONFLICT (region, record_no) DO NOTHING;

                v_mutated := TRUE;
              END LOOP;
            END IF;
          END IF;
        END IF;
      END IF;

      -- Refresh current checkpoint rating if any rollback/restoration mutated solare_players.rank_rating
      IF v_mutated THEN
        UPDATE solare_player_wl_checkpoints cp
        SET
          checkpoint_rating = sp.rank_rating,
          checkpoint_rating_is_estimated = COALESCE(sp.rating_is_estimated, FALSE),
          updated_at = timezone('utc', now())
        FROM solare_players sp
        WHERE cp.region = v_player.region
          AND cp.user_no = v_player.user_no
          AND cp.season = v_season
          AND cp.checkpoint_record_no = v_curr_max_rn
          AND sp.region = v_player.region
          AND sp.user_no = v_player.user_no;
      END IF;

      RETURN v_mutated;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_infer_unseeded_solare_player_rating(
      p_region VARCHAR,
      p_user_no BIGINT,
      p_user_nickname VARCHAR
    )
    RETURNS BOOLEAN AS $$
    DECLARE
      v_player RECORD;
      v_has_inferred_event BOOLEAN;
      v_upper_bound INTEGER;
      v_lower_bound INTEGER;
      v_upper_rank INTEGER;
      v_lower_rank INTEGER;
      v_stats RECORD;
      v_rem_w INTEGER;
      v_rem_l INTEGER;
      v_rem_d INTEGER;
      v_rem_total INTEGER;
      v_comb_w BIGINT;
      v_comb_l BIGINT;
      v_comb_d BIGINT;
      v_combo_res RECORD;
      v_prac_rn BIGINT;
      v_ranked_rn BIGINT;
      v_newly_proven_count INTEGER := 0;
      v_math_solved BOOLEAN := FALSE;
      v_use_excluded BOOLEAN := FALSE;
      v_has_unresolved_excess BOOLEAN := FALSE;
      v_eff_pre_w INTEGER;
      v_eff_pre_l INTEGER;
      v_eff_pre_d INTEGER;
      v_dist_full INTEGER;
      v_dist_excl INTEGER;
      v_total_delta INTEGER := 0;
      v_max_record_no BIGINT := NULL;
      v_match_count INTEGER := 0;
      v_cand_base INTEGER := NULL;
      v_cand_rating INTEGER := NULL;
      v_bracket_dist INTEGER := NULL;
      v_is_estimate BOOLEAN := FALSE;
      v_final_rating INTEGER;
      v_base_rating INTEGER;
    BEGIN
      SELECT
        region,
        user_no,
        user_nickname,
        season,
        current_ranking,
        rank_rating,
        rating_is_estimated,
        rating_anchor_record_no,
        rating_achieved_record_no,
        win_count,
        lose_count,
        draw_count,
        last_seen_at
      INTO v_player
      FROM solare_players
      WHERE region = p_region
        AND (
          (p_user_no IS NOT NULL AND user_no = p_user_no)
          OR (p_user_no IS NULL AND LOWER(user_nickname) = LOWER(p_user_nickname))
        )
      ORDER BY updated_at DESC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND
         OR v_player.rating_anchor_record_no IS NOT NULL
         OR v_player.current_ranking IS NULL
         OR v_player.current_ranking < 1 THEN
        RETURN FALSE;
      END IF;

      IF v_player.rank_rating IS NOT NULL AND NOT COALESCE(v_player.rating_is_estimated, FALSE) THEN
        SELECT EXISTS (
          SELECT 1
          FROM solare_player_rating_events e
          WHERE e.region = v_player.region
            AND e.user_no = v_player.user_no
            AND e.event_type = 'inferred_start'
            AND COALESCE(e.season, 9) = COALESCE(v_player.season, 9)
            AND e.id > COALESCE((
              SELECT MAX(ep.id)
              FROM solare_player_rating_events ep
              WHERE ep.region = v_player.region
                AND ep.user_no = v_player.user_no
                AND ep.event_type IN ('season_reset', 'seed_anchor', 'reconcile')
            ), 0)
        ) INTO v_has_inferred_event;

        IF NOT v_has_inferred_event THEN
          RETURN FALSE;
        END IF;
      END IF;

      SELECT
        b.upper_bound,
        b.upper_rank,
        b.lower_bound,
        b.lower_rank
      INTO
        v_upper_bound,
        v_upper_rank,
        v_lower_bound,
        v_lower_rank
      FROM fn_get_solare_monotonic_neighbor_bounds(
        v_player.region,
        v_player.user_no,
        v_player.user_nickname,
        COALESCE(v_player.season, 9)::smallint,
        v_player.current_ranking
      ) b;

      IF (v_player.current_ranking > 1 AND v_upper_bound IS NULL)
         OR (v_player.current_ranking = 1 AND v_lower_bound IS NULL) THEN
        RETURN FALSE;
      END IF;

      WITH player_matches AS (
        SELECT
          mp.record_no,
          mp.vary_rank_rating,
          m.match_date,
          NULLIF(TRIM(m.repz_download_url), '') IS NOT NULL AS has_repz,
          CASE
            WHEN mp.is_winner THEN 'w'
            WHEN EXISTS (
              SELECT 1
              FROM solare_match_players w
              WHERE w.region = mp.region
                AND w.record_no = mp.record_no
                AND w.is_winner
            ) THEN 'l'
            ELSE 'd'
          END AS outcome,
          (pr.mode = 'practice') IS TRUE AS is_proven_practice,
          (pr.mode = 'ranked') IS TRUE AS is_proven_ranked,
          (ps.record_no IS NOT NULL) AS is_suspect,
          (
            v_player.last_seen_at IS NOT NULL
            AND m.match_date IS NOT NULL
            AND m.match_date > v_player.last_seen_at + INTERVAL '10 seconds'
          ) AS is_post_snapshot
        FROM solare_match_players mp
        LEFT JOIN solare_matches m
          ON m.region = mp.region AND m.record_no = mp.record_no
        LEFT JOIN solare_match_mode_proofs pr
          ON pr.region = mp.region AND pr.record_no = mp.record_no
        LEFT JOIN solare_practice_suspect_matches ps
          ON ps.region = mp.region AND ps.record_no = mp.record_no
        WHERE mp.region = v_player.region
          AND (
            m.record_no IS NULL
            OR COALESCE(m.season, 9) = COALESCE(v_player.season, 9)
          )
          AND (
            (v_player.user_no IS NOT NULL AND mp.user_no = v_player.user_no)
            OR ((v_player.user_no IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER(v_player.user_nickname))
          )
      )
      SELECT
        COUNT(*) FILTER (WHERE is_proven_practice)::integer AS proven_practice_count,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND outcome = 'w')::integer AS non_prac_w,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND outcome = 'l')::integer AS non_prac_l,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND outcome = 'd')::integer AS non_prac_d,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_post_snapshot AND outcome = 'w')::integer AS pre_w,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_post_snapshot AND outcome = 'l')::integer AS pre_l,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_post_snapshot AND outcome = 'd')::integer AS pre_d,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_suspect AND outcome = 'w')::integer AS excl_w,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_suspect AND outcome = 'l')::integer AS excl_l,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_suspect AND outcome = 'd')::integer AS excl_d,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_suspect AND NOT is_post_snapshot AND outcome = 'w')::integer AS excl_pre_w,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_suspect AND NOT is_post_snapshot AND outcome = 'l')::integer AS excl_pre_l,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_suspect AND NOT is_post_snapshot AND outcome = 'd')::integer AS excl_pre_d,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND is_suspect)::integer AS suspect_count,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND vary_rank_rating IS NULL)::integer AS null_pdl_count,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND is_post_snapshot)::integer AS post_snapshot_count,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_proven_ranked AND NOT has_repz AND outcome = 'w')::integer AS cand_w,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_proven_ranked AND NOT has_repz AND outcome = 'l')::integer AS cand_l,
        COUNT(*) FILTER (WHERE NOT is_proven_practice AND NOT is_proven_ranked AND NOT has_repz AND outcome = 'd')::integer AS cand_d,
        COALESCE(SUM(vary_rank_rating) FILTER (WHERE NOT is_proven_practice AND vary_rank_rating IS NOT NULL), 0)::integer AS non_prac_delta
      INTO v_stats
      FROM player_matches;

      v_rem_w := v_stats.non_prac_w - COALESCE(v_player.win_count, 0);
      v_rem_l := v_stats.non_prac_l - COALESCE(v_player.lose_count, 0);
      v_rem_d := v_stats.non_prac_d - COALESCE(v_player.draw_count, 0);
      v_rem_total := v_rem_w + v_rem_l + v_rem_d;

      -- Real-time combinatorial proof when excess is small (1..4) and W/L/D is synchronized
      IF v_rem_w >= 0
         AND v_rem_l >= 0
         AND v_rem_d >= 0
         AND v_rem_total BETWEEN 1 AND 4
         AND v_stats.null_pdl_count = 0
         AND v_stats.post_snapshot_count = 0
         AND v_stats.cand_w >= v_rem_w
         AND v_stats.cand_l >= v_rem_l
         AND v_stats.cand_d >= v_rem_d
         AND v_lower_bound IS NOT NULL
         AND (v_player.current_ranking = 1 OR (v_upper_bound IS NOT NULL AND v_upper_bound >= v_lower_bound)) THEN

        v_comb_w := CASE v_rem_w
          WHEN 0 THEN 1
          WHEN 1 THEN v_stats.cand_w
          WHEN 2 THEN (v_stats.cand_w::bigint * (v_stats.cand_w - 1)) / 2
          WHEN 3 THEN (v_stats.cand_w::bigint * (v_stats.cand_w - 1) * (v_stats.cand_w - 2)) / 6
          ELSE (v_stats.cand_w::bigint * (v_stats.cand_w - 1) * (v_stats.cand_w - 2) * (v_stats.cand_w - 3)) / 24
        END;
        v_comb_l := CASE v_rem_l
          WHEN 0 THEN 1
          WHEN 1 THEN v_stats.cand_l
          WHEN 2 THEN (v_stats.cand_l::bigint * (v_stats.cand_l - 1)) / 2
          WHEN 3 THEN (v_stats.cand_l::bigint * (v_stats.cand_l - 1) * (v_stats.cand_l - 2)) / 6
          ELSE (v_stats.cand_l::bigint * (v_stats.cand_l - 1) * (v_stats.cand_l - 2) * (v_stats.cand_l - 3)) / 24
        END;
        v_comb_d := CASE v_rem_d
          WHEN 0 THEN 1
          WHEN 1 THEN v_stats.cand_d
          WHEN 2 THEN (v_stats.cand_d::bigint * (v_stats.cand_d - 1)) / 2
          WHEN 3 THEN (v_stats.cand_d::bigint * (v_stats.cand_d - 1) * (v_stats.cand_d - 2)) / 6
          ELSE (v_stats.cand_d::bigint * (v_stats.cand_d - 1) * (v_stats.cand_d - 2) * (v_stats.cand_d - 3)) / 24
        END;

        IF (v_comb_w * v_comb_l * v_comb_d) BETWEEN 1 AND 5000 THEN
          WITH RECURSIVE
          player_cand AS (
            SELECT
              mp.record_no,
              mp.vary_rank_rating::int AS v,
              CASE
                WHEN mp.is_winner THEN 'w'
                WHEN EXISTS (
                  SELECT 1
                  FROM solare_match_players w
                  WHERE w.region = mp.region
                    AND w.record_no = mp.record_no
                    AND w.is_winner
                ) THEN 'l'
                ELSE 'd'
              END AS outcome,
              fn_is_solare_practice_contradicted(
                v_player.region,
                mp.record_no,
                v_player.user_no,
                v_player.user_nickname,
                COALESCE(v_player.season, 9)
              ) AS is_contradicted
            FROM solare_match_players mp
            LEFT JOIN solare_matches m
              ON m.region = mp.region AND m.record_no = mp.record_no
            LEFT JOIN solare_match_mode_proofs pr
              ON pr.region = mp.region AND pr.record_no = mp.record_no
            WHERE mp.region = v_player.region
              AND COALESCE(pr.mode, '') NOT IN ('practice', 'ranked')
              AND NULLIF(TRIM(m.repz_download_url), '') IS NULL
              AND (
                m.record_no IS NULL
                OR COALESCE(m.season, 9) = COALESCE(v_player.season, 9)
              )
              AND (
                (v_player.user_no IS NOT NULL AND mp.user_no = v_player.user_no)
                OR ((v_player.user_no IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER(v_player.user_nickname))
              )
          ),
          cand_w AS (
            SELECT ROW_NUMBER() OVER (ORDER BY record_no)::int AS idx, record_no, v, is_contradicted
            FROM player_cand
            WHERE outcome = 'w' AND v_rem_w > 0
          ),
          comb_w(last_idx, depth, rns, sum_v, has_contra) AS (
            SELECT 0, 0, ARRAY[]::bigint[], 0, FALSE
            UNION ALL
            SELECT cw.idx, c.depth + 1, c.rns || cw.record_no, c.sum_v + cw.v, (c.has_contra OR cw.is_contradicted)
            FROM comb_w c
            INNER JOIN cand_w cw ON cw.idx > c.last_idx
            WHERE c.depth < v_rem_w
          ),
          cand_l AS (
            SELECT ROW_NUMBER() OVER (ORDER BY record_no)::int AS idx, record_no, v, is_contradicted
            FROM player_cand
            WHERE outcome = 'l' AND v_rem_l > 0
          ),
          comb_l(last_idx, depth, rns, sum_v, has_contra) AS (
            SELECT 0, 0, ARRAY[]::bigint[], 0, FALSE
            UNION ALL
            SELECT cl.idx, c.depth + 1, c.rns || cl.record_no, c.sum_v + cl.v, (c.has_contra OR cl.is_contradicted)
            FROM comb_l c
            INNER JOIN cand_l cl ON cl.idx > c.last_idx
            WHERE c.depth < v_rem_l
          ),
          cand_d AS (
            SELECT ROW_NUMBER() OVER (ORDER BY record_no)::int AS idx, record_no, v, is_contradicted
            FROM player_cand
            WHERE outcome = 'd' AND v_rem_d > 0
          ),
          comb_d(last_idx, depth, rns, sum_v, has_contra) AS (
            SELECT 0, 0, ARRAY[]::bigint[], 0, FALSE
            UNION ALL
            SELECT cd.idx, c.depth + 1, c.rns || cd.record_no, c.sum_v + cd.v, (c.has_contra OR cd.is_contradicted)
            FROM comb_d c
            INNER JOIN cand_d cd ON cd.idx > c.last_idx
            WHERE c.depth < v_rem_d
          ),
          valid_combos AS (
            SELECT
              (vw.rns || vl.rns || vd.rns) AS excl_rns,
              (v_stats.non_prac_delta - vw.sum_v - vl.sum_v - vd.sum_v)::int AS net_delta,
              (vw.has_contra OR vl.has_contra OR vd.has_contra) AS has_contra
            FROM (SELECT rns, sum_v, has_contra FROM comb_w WHERE depth = v_rem_w) vw
            CROSS JOIN (SELECT rns, sum_v, has_contra FROM comb_l WHERE depth = v_rem_l) vl
            CROSS JOIN (SELECT rns, sum_v, has_contra FROM comb_d WHERE depth = v_rem_d) vd
            WHERE EXISTS (
              SELECT 1
              FROM unnest(ARRAY[401, 501, 601, 701, 801]) AS b
              WHERE GREATEST(0, b + (v_stats.non_prac_delta - vw.sum_v - vl.sum_v - vd.sum_v)) >= v_lower_bound
                AND (
                  v_upper_bound IS NULL
                  OR GREATEST(0, b + (v_stats.non_prac_delta - vw.sum_v - vl.sum_v - vd.sum_v)) <= v_upper_bound
                )
            )
          ),
          combo_summary AS (
            SELECT
              COUNT(*)::int AS valid_count,
              COUNT(*) FILTER (WHERE NOT has_contra)::int AS uncontradicted_valid_count,
              COUNT(DISTINCT net_delta)::int AS distinct_deltas,
              MIN(net_delta)::int AS sample_net_delta
            FROM valid_combos
          ),
          mandatory_rns AS (
            SELECT x.rn
            FROM valid_combos vc
            CROSS JOIN LATERAL unnest(vc.excl_rns) AS x(rn)
            CROSS JOIN combo_summary cs
            WHERE cs.valid_count > 0
            GROUP BY x.rn, cs.valid_count
            HAVING COUNT(*) = cs.valid_count
          ),
          mandatory_ranked_rns AS (
            SELECT pc.record_no AS rn
            FROM player_cand pc
            CROSS JOIN combo_summary cs
            WHERE cs.valid_count > 0
              AND NOT EXISTS (
                SELECT 1
                FROM valid_combos vc
                WHERE pc.record_no = ANY(vc.excl_rns)
              )
          )
          SELECT
            cs.valid_count,
            cs.uncontradicted_valid_count,
            cs.distinct_deltas,
            cs.sample_net_delta,
            COALESCE((SELECT ARRAY_AGG(rn ORDER BY rn) FROM mandatory_rns), ARRAY[]::bigint[]) AS mandatory_practice_rns,
            COALESCE((SELECT ARRAY_AGG(rn ORDER BY rn) FROM mandatory_ranked_rns), ARRAY[]::bigint[]) AS mandatory_ranked_rns
          INTO v_combo_res
          FROM combo_summary cs;

          IF v_combo_res.valid_count > 0 AND v_combo_res.uncontradicted_valid_count > 0 THEN
            FOREACH v_prac_rn IN ARRAY v_combo_res.mandatory_practice_rns
            LOOP
              INSERT INTO solare_match_mode_proofs (region, record_no, mode, method)
              VALUES (v_player.region, v_prac_rn, 'practice', 'trigger_math')
              ON CONFLICT (region, record_no) DO NOTHING;

              v_newly_proven_count := v_newly_proven_count + 1;
            END LOOP;

            FOREACH v_ranked_rn IN ARRAY v_combo_res.mandatory_ranked_rns
            LOOP
              INSERT INTO solare_match_mode_proofs (region, record_no, mode, method)
              VALUES (v_player.region, v_ranked_rn, 'ranked', 'trigger_math')
              ON CONFLICT (region, record_no) DO NOTHING;
            END LOOP;

            IF v_combo_res.distinct_deltas = 1
               AND CARDINALITY(v_combo_res.mandatory_practice_rns) = v_rem_total THEN
              v_math_solved := TRUE;
              v_total_delta := v_combo_res.sample_net_delta;

              SELECT
                MAX(mp.record_no),
                COUNT(*)::integer
              INTO
                v_max_record_no,
                v_match_count
              FROM solare_match_players mp
              LEFT JOIN solare_matches m
                ON m.region = mp.region AND m.record_no = mp.record_no
              LEFT JOIN solare_match_mode_proofs pr
                ON pr.region = mp.region AND pr.record_no = mp.record_no
              WHERE mp.region = v_player.region
                AND COALESCE(pr.mode, '') <> 'practice'
                AND (
                  m.record_no IS NULL
                  OR COALESCE(m.season, 9) = COALESCE(v_player.season, 9)
                )
                AND (
                  (v_player.user_no IS NOT NULL AND mp.user_no = v_player.user_no)
                  OR ((v_player.user_no IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER(v_player.user_nickname))
                );
            END IF;
          END IF;
        END IF;
      END IF;

      IF NOT v_math_solved THEN
        IF v_stats.suspect_count > 0 THEN
          v_dist_full :=
            ABS(v_stats.non_prac_w - COALESCE(v_player.win_count, 0))
            + ABS(v_stats.non_prac_l - COALESCE(v_player.lose_count, 0))
            + ABS(v_stats.non_prac_d - COALESCE(v_player.draw_count, 0));
          v_dist_excl :=
            ABS(v_stats.excl_w - COALESCE(v_player.win_count, 0))
            + ABS(v_stats.excl_l - COALESCE(v_player.lose_count, 0))
            + ABS(v_stats.excl_d - COALESCE(v_player.draw_count, 0));

          v_use_excluded :=
            v_dist_excl < v_dist_full
            AND v_dist_excl <= 2
            AND v_stats.excl_w <= COALESCE(v_player.win_count, 0)
            AND v_stats.excl_l <= COALESCE(v_player.lose_count, 0)
            AND v_stats.excl_d <= COALESCE(v_player.draw_count, 0);
        END IF;

        IF v_use_excluded THEN
          v_eff_pre_w := v_stats.excl_pre_w;
          v_eff_pre_l := v_stats.excl_pre_l;
          v_eff_pre_d := v_stats.excl_pre_d;
        ELSE
          v_eff_pre_w := v_stats.pre_w;
          v_eff_pre_l := v_stats.pre_l;
          v_eff_pre_d := v_stats.pre_d;
        END IF;

        v_has_unresolved_excess :=
          v_eff_pre_w > COALESCE(v_player.win_count, 0)
          OR v_eff_pre_l > COALESCE(v_player.lose_count, 0)
          OR v_eff_pre_d > COALESCE(v_player.draw_count, 0);

        IF NOT v_has_unresolved_excess THEN
          SELECT
            COALESCE(SUM(mp.vary_rank_rating), 0)::integer,
            MAX(mp.record_no),
            COUNT(*)::integer
          INTO
            v_total_delta,
            v_max_record_no,
            v_match_count
          FROM solare_match_players mp
          LEFT JOIN solare_matches m
            ON m.region = mp.region AND m.record_no = mp.record_no
          LEFT JOIN solare_match_mode_proofs pr
            ON pr.region = mp.region AND pr.record_no = mp.record_no
          WHERE mp.region = v_player.region
            AND COALESCE(pr.mode, '') <> 'practice'
            AND mp.vary_rank_rating IS NOT NULL
            AND mp.vary_rank_rating <> 0
            AND (
              m.record_no IS NULL
              OR COALESCE(m.season, 9) = COALESCE(v_player.season, 9)
            )
            AND (
              (v_player.user_no IS NOT NULL AND mp.user_no = v_player.user_no)
              OR ((v_player.user_no IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER(v_player.user_nickname))
            )
            AND (
              NOT v_use_excluded
              OR NOT EXISTS (
                SELECT 1
                FROM solare_practice_suspect_matches ps
                WHERE ps.region = mp.region
                  AND ps.record_no = mp.record_no
              )
            );
        END IF;
      END IF;

      IF v_match_count > 0 AND v_max_record_no IS NOT NULL THEN
        SELECT
          b AS base_rating,
          GREATEST(0, b + v_total_delta)::integer AS candidate_rating,
          CASE
            WHEN v_upper_bound IS NOT NULL AND GREATEST(0, b + v_total_delta) > v_upper_bound
              THEN GREATEST(0, b + v_total_delta) - v_upper_bound
            WHEN v_lower_bound IS NOT NULL AND GREATEST(0, b + v_total_delta) < v_lower_bound
              THEN v_lower_bound - GREATEST(0, b + v_total_delta)
            ELSE 0
          END AS bracket_distance
        INTO
          v_cand_base,
          v_cand_rating,
          v_bracket_dist
        FROM unnest(ARRAY[401, 501, 601, 701, 801]) AS b
        ORDER BY
          bracket_distance ASC,
          CASE
            WHEN v_upper_bound IS NOT NULL AND v_lower_bound IS NOT NULL
              THEN ABS(GREATEST(0, b + v_total_delta) - ((v_upper_bound + v_lower_bound) / 2.0))
            ELSE 0
          END ASC,
          b ASC
        LIMIT 1;
      END IF;

      IF v_match_count > 0
         AND v_bracket_dist IS NOT NULL
         AND v_bracket_dist <= 45
         AND (
           (
             v_lower_bound IS NOT NULL
             AND (v_upper_bound IS NULL OR v_upper_bound >= v_lower_bound)
           )
           OR (
             v_lower_bound IS NULL
             AND v_upper_bound IS NOT NULL
             AND NOT v_has_unresolved_excess
             AND v_eff_pre_w = COALESCE(v_player.win_count, 0)
             AND v_eff_pre_l = COALESCE(v_player.lose_count, 0)
             AND v_eff_pre_d = COALESCE(v_player.draw_count, 0)
             AND v_stats.null_pdl_count = 0
             AND v_stats.post_snapshot_count = 0
             AND v_cand_base = 401
             AND v_cand_rating BETWEEN (v_upper_bound - 45) AND v_upper_bound
           )
         ) THEN
        v_final_rating := v_cand_rating;
        v_base_rating := v_cand_base;
        v_is_estimate := FALSE;
      ELSE
        -- Fallback: linear interpolation between consistent exact neighbors within 40 points
        IF v_upper_bound IS NULL
           OR v_lower_bound IS NULL
           OR v_upper_bound < v_lower_bound
           OR v_upper_bound - v_lower_bound > 40
           OR v_lower_rank <= v_upper_rank THEN
          RETURN FALSE;
        END IF;

        v_is_estimate := TRUE;
        v_base_rating := NULL;
        v_total_delta := 0;
        v_max_record_no := NULL;
        v_final_rating := ROUND(
          v_upper_bound
          - (v_upper_bound - v_lower_bound)::numeric
            * (v_player.current_ranking - v_upper_rank)
            / (v_lower_rank - v_upper_rank)
        )::integer;
      END IF;

      IF v_player.rank_rating IS NOT DISTINCT FROM v_final_rating
         AND v_player.rating_is_estimated IS NOT DISTINCT FROM v_is_estimate
         AND v_player.rating_achieved_record_no IS NOT DISTINCT FROM v_max_record_no THEN
        RETURN FALSE;
      END IF;

      DELETE FROM solare_player_rating_events e
      WHERE e.region = v_player.region
        AND e.user_no = v_player.user_no
        AND e.event_type = 'inferred_start'
        AND COALESCE(e.season, 9) = COALESCE(v_player.season, 9)
        AND e.id > COALESCE((
          SELECT MAX(ep.id)
          FROM solare_player_rating_events ep
          WHERE ep.region = v_player.region
            AND ep.user_no = v_player.user_no
            AND ep.event_type IN ('season_reset', 'seed_anchor', 'reconcile')
        ), 0);

      INSERT INTO solare_player_rating_events (
        region,
        season,
        user_no,
        user_nickname,
        event_type,
        previous_rating,
        new_rating,
        rating_delta,
        record_no,
        metadata
      )
      VALUES (
        v_player.region,
        v_player.season,
        v_player.user_no,
        v_player.user_nickname,
        'inferred_start',
        v_base_rating,
        v_final_rating,
        v_total_delta,
        v_max_record_no,
        jsonb_build_object(
          'inferred_start_rating', v_base_rating,
          'estimated', v_is_estimate,
          'estimate_method', CASE WHEN v_is_estimate THEN 'neighbor_interpolation' ELSE NULL END,
          'upper_rank', v_upper_rank,
          'lower_rank', v_lower_rank,
          'total_delta', v_total_delta,
          'upper_bound', v_upper_bound,
          'lower_bound', v_lower_bound,
          'excluded_proven_practice', v_stats.proven_practice_count + v_newly_proven_count,
          'excluded_practice_suspects', CASE WHEN v_use_excluded THEN v_stats.suspect_count ELSE 0 END
        )
      );

      UPDATE solare_players
      SET
        rank_rating = v_final_rating,
        rating_is_estimated = v_is_estimate,
        rating_achieved_record_no = v_max_record_no,
        rating_achieved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
      WHERE region = v_player.region
        AND user_no = v_player.user_no;

      RETURN TRUE;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_trg_solare_player_infer_rating()
    RETURNS TRIGGER AS $$
    DECLARE
      v_snapshot_advanced BOOLEAN := FALSE;
    BEGIN
      IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
      END IF;

      IF TG_OP = 'INSERT' THEN
        v_snapshot_advanced := NEW.last_seen_at IS NOT NULL;
      ELSIF TG_OP = 'UPDATE' THEN
        v_snapshot_advanced :=
          (
            NEW.last_seen_at IS NOT NULL
            AND (OLD.last_seen_at IS NULL OR NEW.last_seen_at > OLD.last_seen_at)
          )
          OR NEW.win_count IS DISTINCT FROM OLD.win_count
          OR NEW.lose_count IS DISTINCT FROM OLD.lose_count
          OR NEW.draw_count IS DISTINCT FROM OLD.draw_count;
      END IF;

      IF NEW.current_ranking IS NOT NULL AND NEW.rating_anchor_record_no IS NULL
         AND (
           NEW.rank_rating IS NULL
           OR NEW.rating_is_estimated = TRUE
           OR v_snapshot_advanced
         ) THEN
        PERFORM fn_infer_unseeded_solare_player_rating(
          NEW.region,
          NEW.user_no,
          NEW.user_nickname
        );
      END IF;

      IF v_snapshot_advanced AND NEW.current_ranking IS NOT NULL AND NEW.user_no IS NOT NULL THEN
        PERFORM fn_process_solare_player_wl_checkpoint(
          NEW.region,
          NEW.user_no
        );
      ELSIF TG_OP = 'UPDATE' AND NEW.user_no IS NOT NULL THEN
        UPDATE solare_player_wl_checkpoints cp
        SET
          checkpoint_rating = sp.rank_rating,
          checkpoint_rating_is_estimated = COALESCE(sp.rating_is_estimated, FALSE),
          updated_at = timezone('utc', now())
        FROM solare_players sp
        WHERE cp.region = NEW.region
          AND cp.user_no = NEW.user_no
          AND cp.season = COALESCE(sp.season, 9)
          AND sp.region = NEW.region
          AND sp.user_no = NEW.user_no
          AND (
            cp.checkpoint_rating IS DISTINCT FROM sp.rank_rating
            OR cp.checkpoint_rating_is_estimated IS DISTINCT FROM COALESCE(sp.rating_is_estimated, FALSE)
          )
          AND cp.checkpoint_record_no = (
            SELECT MAX(cp2.checkpoint_record_no)
            FROM solare_player_wl_checkpoints cp2
            WHERE cp2.region = NEW.region
              AND cp2.user_no = NEW.user_no
              AND cp2.season = COALESCE(sp.season, 9)
          )
          AND cp.checkpoint_record_no >= GREATEST(
            COALESCE(sp.rating_achieved_record_no, 0),
            COALESCE(sp.rating_anchor_record_no, 0)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM solare_match_players mp_after
            LEFT JOIN solare_matches m_after
              ON m_after.region = mp_after.region AND m_after.record_no = mp_after.record_no
            LEFT JOIN solare_match_mode_proofs pr_after
              ON pr_after.region = mp_after.region AND pr_after.record_no = mp_after.record_no
            WHERE mp_after.region = NEW.region
              AND mp_after.record_no > cp.checkpoint_record_no
              AND COALESCE(pr_after.mode, '') <> 'practice'
              AND (
                mp_after.user_no = NEW.user_no
                OR (mp_after.user_no IS NULL AND LOWER(mp_after.user_nickname) = LOWER(sp.user_nickname))
              )
              AND (
                m_after.record_no IS NULL
                OR COALESCE(m_after.season, 9) = COALESCE(sp.season, 9)
              )
          );
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_solare_player_infer_rating ON solare_players;

    CREATE TRIGGER trg_solare_player_infer_rating
    AFTER INSERT OR UPDATE OF current_ranking, rank_rating, rating_is_estimated, win_count, lose_count, draw_count, last_seen_at
    ON solare_players
    FOR EACH ROW
    WHEN (NEW.current_ranking IS NOT NULL)
    EXECUTE FUNCTION fn_trg_solare_player_infer_rating();

    CREATE OR REPLACE FUNCTION fn_apply_solare_match_rating_delta()
    RETURNS TRIGGER AS $$
    DECLARE
      v_player RECORD;
      v_has_inferred_event BOOLEAN;
      v_match_at TIMESTAMPTZ;
      v_match_season SMALLINT;
      v_new_rating INTEGER;
      v_achieved_record_no BIGINT;
      v_inserted_id BIGINT;
    BEGIN
      IF NEW.vary_rank_rating IS NULL OR NEW.vary_rank_rating = 0 THEN
        RETURN NEW;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM solare_match_mode_proofs smp
        WHERE smp.region = NEW.region
          AND smp.record_no = NEW.record_no
          AND smp.mode = 'practice'
      ) THEN
        RETURN NEW;
      END IF;

      SELECT
        user_no,
        user_nickname,
        season,
        current_ranking,
        rank_rating,
        rating_is_estimated,
        rating_anchor_record_no,
        rating_achieved_record_no
      INTO v_player
      FROM solare_players
      WHERE region = NEW.region
        AND (
          (NEW.user_no IS NOT NULL AND user_no = NEW.user_no)
          OR (NEW.user_no IS NULL AND LOWER(user_nickname) = LOWER(NEW.user_nickname))
        )
      ORDER BY updated_at DESC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN NEW;
      END IF;

      SELECT
        m.season,
        COALESCE(m.match_date, m.crawled_at, NEW.created_at, timezone('utc', now()))
      INTO
        v_match_season,
        v_match_at
      FROM solare_matches m
      WHERE m.region = NEW.region AND m.record_no = NEW.record_no
      LIMIT 1;

      IF FOUND AND COALESCE(v_match_season, 9) <> COALESCE(v_player.season, 9) THEN
        RETURN NEW;
      END IF;

      IF v_player.rank_rating IS NULL THEN
        PERFORM fn_infer_unseeded_solare_player_rating(
          NEW.region,
          v_player.user_no,
          v_player.user_nickname
        );
        RETURN NEW;
      END IF;

      IF v_player.rating_anchor_record_no IS NULL THEN
        SELECT EXISTS (
          SELECT 1
          FROM solare_player_rating_events e
          WHERE e.region = NEW.region
            AND e.user_no = v_player.user_no
            AND e.event_type = 'inferred_start'
            AND COALESCE(e.season, 9) = COALESCE(v_player.season, 9)
            AND e.id > COALESCE((
              SELECT MAX(ep.id)
              FROM solare_player_rating_events ep
              WHERE ep.region = NEW.region
                AND ep.user_no = v_player.user_no
                AND ep.event_type IN ('season_reset', 'seed_anchor', 'reconcile')
            ), 0)
        ) INTO v_has_inferred_event;

        IF v_has_inferred_event OR COALESCE(v_player.rating_is_estimated, FALSE) THEN
          PERFORM fn_infer_unseeded_solare_player_rating(
            NEW.region,
            v_player.user_no,
            v_player.user_nickname
          );
          RETURN NEW;
        END IF;
      END IF;

      IF NEW.record_no <= COALESCE(v_player.rating_anchor_record_no, 0) THEN
        RETURN NEW;
      END IF;

      v_new_rating := GREATEST(0, v_player.rank_rating + NEW.vary_rank_rating);

      INSERT INTO solare_player_rating_events (
        region,
        season,
        user_no,
        user_nickname,
        event_type,
        previous_rating,
        new_rating,
        rating_delta,
        record_no,
        metadata
      )
      VALUES (
        NEW.region,
        v_player.season,
        v_player.user_no,
        v_player.user_nickname,
        'match_delta',
        v_player.rank_rating,
        v_new_rating,
        NEW.vary_rank_rating,
        NEW.record_no,
        jsonb_build_object(
          'is_winner', NEW.is_winner,
          'class_type', NEW.class_type,
          'skill_branch_type', NEW.skill_branch_type
        )
      )
      ON CONFLICT (region, user_no, record_no)
      WHERE event_type = 'match_delta' AND record_no IS NOT NULL
      DO NOTHING
      RETURNING id INTO v_inserted_id;

      IF v_inserted_id IS NULL THEN
        RETURN NEW;
      END IF;

      IF v_match_at IS NULL THEN
        v_match_at := COALESCE(NEW.created_at, timezone('utc', now()));
      END IF;

      v_achieved_record_no := GREATEST(
        COALESCE(v_player.rating_achieved_record_no, 0),
        NEW.record_no
      );

      UPDATE solare_players
      SET
        rank_rating = v_new_rating,
        rating_achieved_record_no = v_achieved_record_no,
        rating_achieved_at = CASE
          WHEN NEW.record_no >= COALESCE(v_player.rating_achieved_record_no, 0) THEN v_match_at
          ELSE COALESCE(rating_achieved_at, v_match_at)
        END,
        updated_at = timezone('utc', now())
      WHERE region = NEW.region
        AND user_no = v_player.user_no;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    DO $$
    DECLARE
      v_rec RECORD;
      v_pass INTEGER;
    BEGIN
      FOR v_pass IN 1..2 LOOP
        FOR v_rec IN
          SELECT
            sp.region,
            sp.user_no,
            sp.user_nickname
          FROM solare_players sp
          WHERE sp.rating_anchor_record_no IS NULL
            AND sp.current_ranking IS NOT NULL
            AND sp.current_ranking >= 1
            AND (
              sp.rank_rating IS NULL
              OR sp.rating_is_estimated = TRUE
              OR EXISTS (
                SELECT 1
                FROM solare_player_rating_events e
                WHERE e.region = sp.region
                  AND e.user_no = sp.user_no
                  AND e.event_type = 'inferred_start'
                  AND COALESCE(e.season, 9) = COALESCE(sp.season, 9)
                  AND (e.metadata->>'upper_bound')::int < (e.metadata->>'lower_bound')::int
              )
            )
          ORDER BY
            sp.region ASC,
            sp.current_ranking ASC,
            sp.last_seen_at DESC NULLS LAST,
            sp.updated_at DESC NULLS LAST
        LOOP
          PERFORM fn_infer_unseeded_solare_player_rating(
            v_rec.region,
            v_rec.user_no,
            v_rec.user_nickname
          );
        END LOOP;
      END LOOP;
    END;
    $$;

    INSERT INTO solare_player_wl_checkpoints (
      region,
      user_no,
      season,
      checkpoint_record_no,
      checkpoint_at,
      win_count,
      lose_count,
      draw_count,
      checkpoint_rating,
      checkpoint_rating_is_estimated,
      updated_at
    )
    SELECT DISTINCT ON (sp.region, sp.user_no, COALESCE(sp.season, 9))
      sp.region,
      sp.user_no,
      COALESCE(sp.season, 9)::smallint AS season,
      GREATEST(
        COALESCE(max_mp.max_record_no, 0),
        COALESCE(sp.rating_anchor_record_no, 0)
      ) AS checkpoint_record_no,
      COALESCE(sp.last_seen_at, sp.updated_at, timezone('utc', now())) AS checkpoint_at,
      COALESCE(sp.win_count, 0),
      COALESCE(sp.lose_count, 0),
      COALESCE(sp.draw_count, 0),
      sp.rank_rating,
      COALESCE(sp.rating_is_estimated, FALSE),
      timezone('utc', now())
    FROM solare_players sp
    LEFT JOIN LATERAL (
      SELECT MAX(mp.record_no) AS max_record_no
      FROM solare_match_players mp
      LEFT JOIN solare_matches m
        ON m.region = mp.region AND m.record_no = mp.record_no
      WHERE mp.region = sp.region
        AND (
          mp.user_no = sp.user_no
          OR (mp.user_no IS NULL AND LOWER(mp.user_nickname) = LOWER(sp.user_nickname))
        )
        AND (
          m.record_no IS NULL
          OR COALESCE(m.season, 9) = COALESCE(sp.season, 9)
        )
    ) max_mp ON TRUE
    WHERE sp.user_no IS NOT NULL
      AND sp.current_ranking IS NOT NULL
      AND sp.current_ranking >= 1
      AND sp.win_count IS NOT NULL
      AND sp.lose_count IS NOT NULL
      AND (
        sp.last_seen_at IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM solare_match_players mp_post
          INNER JOIN solare_matches m_post
            ON m_post.region = mp_post.region AND m_post.record_no = mp_post.record_no
          LEFT JOIN solare_match_mode_proofs pr_post
            ON pr_post.region = mp_post.region AND pr_post.record_no = mp_post.record_no
          WHERE mp_post.region = sp.region
            AND COALESCE(pr_post.mode, '') <> 'practice'
            AND (
              mp_post.user_no = sp.user_no
              OR (mp_post.user_no IS NULL AND LOWER(mp_post.user_nickname) = LOWER(sp.user_nickname))
            )
            AND COALESCE(m_post.season, 9) = COALESCE(sp.season, 9)
            AND m_post.match_date IS NOT NULL
            AND m_post.match_date > sp.last_seen_at + INTERVAL '10 seconds'
        )
      )
    ORDER BY
      sp.region ASC,
      sp.user_no ASC,
      COALESCE(sp.season, 9) ASC,
      sp.last_seen_at DESC NULLS LAST,
      sp.updated_at DESC NULLS LAST
    ON CONFLICT (region, user_no, season, checkpoint_record_no) DO UPDATE
    SET
      checkpoint_rating = COALESCE(EXCLUDED.checkpoint_rating, solare_player_wl_checkpoints.checkpoint_rating),
      checkpoint_rating_is_estimated = CASE
        WHEN EXCLUDED.checkpoint_rating IS NOT NULL THEN EXCLUDED.checkpoint_rating_is_estimated
        ELSE solare_player_wl_checkpoints.checkpoint_rating_is_estimated
      END,
      updated_at = timezone('utc', now());
  `);
};

exports.down = () => {
  // No-op: retains monotonic neighbor bracket helper and updated inference/checkpoint functions.
};
