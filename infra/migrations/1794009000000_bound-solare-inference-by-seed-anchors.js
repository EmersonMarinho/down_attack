/**
 * Bounds unseeded Solare rating inference (`fn_get_solare_monotonic_neighbor_bounds` and
 * `fn_infer_unseeded_solare_player_rating`) by the enclosing synchronized `seed_anchor`
 * envelope (`[v_anchor_low - 15, v_anchor_up + 15]`) so multi-hop `inferred_start`
 * neighbors can never cascade-drift away from ground-truth seeded anchors.
 */
exports.up = (pgm) => {
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
      v_anchor_up INTEGER;
      v_anchor_up_rank INTEGER;
      v_anchor_low INTEGER;
      v_anchor_low_rank INTEGER;
      v_anchor_low_a INTEGER;
      v_anchor_low_a_rank INTEGER;
      v_anchor_up_b INTEGER;
      v_anchor_up_b_rank INTEGER;
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
      -- Enclosing ground-truth seeded anchors (rating_anchor_record_no IS NOT NULL)
      SELECT x.rank_rating, x.current_ranking
      INTO v_anchor_up, v_anchor_up_rank
      FROM (
        SELECT DISTINCT ON (sp_a.current_ranking)
          sp_a.user_no,
          sp_a.user_nickname,
          sp_a.season,
          sp_a.current_ranking,
          sp_a.rank_rating,
          sp_a.rating_anchor_record_no,
          sp_a.last_decay_at,
          sp_a.last_seen_at
        FROM solare_players sp_a
        WHERE sp_a.region = p_region
          AND sp_a.current_ranking IS NOT NULL
          AND sp_a.current_ranking < p_current_ranking
          AND (
            sp_a.season = v_target_season
            OR (v_target_season = 9 AND sp_a.season IS NULL)
          )
        ORDER BY
          sp_a.current_ranking DESC,
          sp_a.last_seen_at DESC NULLS LAST,
          sp_a.updated_at DESC NULLS LAST
      ) x
      WHERE x.rating_anchor_record_no IS NOT NULL
        AND x.rank_rating IS NOT NULL
        AND x.last_decay_at IS NULL
        AND NOT EXISTS (
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
            AND (
              mp_post.record_no > x.rating_anchor_record_no
              OR (
                x.last_seen_at IS NOT NULL
                AND m_post.match_date IS NOT NULL
                AND m_post.match_date > x.last_seen_at + INTERVAL '10 seconds'
              )
            )
        )
      ORDER BY x.current_ranking DESC
      LIMIT 1;

      SELECT x.rank_rating, x.current_ranking
      INTO v_anchor_low, v_anchor_low_rank
      FROM (
        SELECT DISTINCT ON (sp_a.current_ranking)
          sp_a.user_no,
          sp_a.user_nickname,
          sp_a.season,
          sp_a.current_ranking,
          sp_a.rank_rating,
          sp_a.rating_anchor_record_no,
          sp_a.last_decay_at,
          sp_a.last_seen_at
        FROM solare_players sp_a
        WHERE sp_a.region = p_region
          AND sp_a.current_ranking IS NOT NULL
          AND sp_a.current_ranking > p_current_ranking
          AND (
            sp_a.season = v_target_season
            OR (v_target_season = 9 AND sp_a.season IS NULL)
          )
        ORDER BY
          sp_a.current_ranking ASC,
          sp_a.last_seen_at DESC NULLS LAST,
          sp_a.updated_at DESC NULLS LAST
      ) x
      WHERE x.rating_anchor_record_no IS NOT NULL
        AND x.rank_rating IS NOT NULL
        AND x.last_decay_at IS NULL
        AND NOT EXISTS (
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
            AND (
              mp_post.record_no > x.rating_anchor_record_no
              OR (
                x.last_seen_at IS NOT NULL
                AND m_post.match_date IS NOT NULL
                AND m_post.match_date > x.last_seen_at + INTERVAL '10 seconds'
              )
            )
        )
      ORDER BY x.current_ranking ASC
      LIMIT 1;

      IF v_anchor_up IS NOT NULL AND v_anchor_low IS NOT NULL AND v_anchor_up < v_anchor_low THEN
        SELECT x.rank_rating, x.current_ranking
        INTO v_anchor_low_a, v_anchor_low_a_rank
        FROM (
          SELECT DISTINCT ON (sp_a.current_ranking)
            sp_a.user_no,
            sp_a.user_nickname,
            sp_a.season,
            sp_a.current_ranking,
            sp_a.rank_rating,
            sp_a.rating_anchor_record_no,
            sp_a.last_decay_at,
            sp_a.last_seen_at
          FROM solare_players sp_a
          WHERE sp_a.region = p_region
            AND sp_a.current_ranking IS NOT NULL
            AND sp_a.current_ranking > v_anchor_low_rank
            AND (
              sp_a.season = v_target_season
              OR (v_target_season = 9 AND sp_a.season IS NULL)
            )
          ORDER BY
            sp_a.current_ranking ASC,
            sp_a.last_seen_at DESC NULLS LAST,
            sp_a.updated_at DESC NULLS LAST
        ) x
        WHERE x.rating_anchor_record_no IS NOT NULL
          AND x.rank_rating IS NOT NULL
          AND x.rank_rating <= v_anchor_up
          AND x.last_decay_at IS NULL
          AND NOT EXISTS (
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
              AND (
                mp_post.record_no > x.rating_anchor_record_no
                OR (
                  x.last_seen_at IS NOT NULL
                  AND m_post.match_date IS NOT NULL
                  AND m_post.match_date > x.last_seen_at + INTERVAL '10 seconds'
                )
              )
          )
        ORDER BY x.current_ranking ASC
        LIMIT 1;

        SELECT x.rank_rating, x.current_ranking
        INTO v_anchor_up_b, v_anchor_up_b_rank
        FROM (
          SELECT DISTINCT ON (sp_a.current_ranking)
            sp_a.user_no,
            sp_a.user_nickname,
            sp_a.season,
            sp_a.current_ranking,
            sp_a.rank_rating,
            sp_a.rating_anchor_record_no,
            sp_a.last_decay_at,
            sp_a.last_seen_at
          FROM solare_players sp_a
          WHERE sp_a.region = p_region
            AND sp_a.current_ranking IS NOT NULL
            AND sp_a.current_ranking < v_anchor_up_rank
            AND (
              sp_a.season = v_target_season
              OR (v_target_season = 9 AND sp_a.season IS NULL)
            )
          ORDER BY
            sp_a.current_ranking DESC,
            sp_a.last_seen_at DESC NULLS LAST,
            sp_a.updated_at DESC NULLS LAST
        ) x
        WHERE x.rating_anchor_record_no IS NOT NULL
          AND x.rank_rating IS NOT NULL
          AND x.rank_rating >= v_anchor_low
          AND x.last_decay_at IS NULL
          AND NOT EXISTS (
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
              AND (
                mp_post.record_no > x.rating_anchor_record_no
                OR (
                  x.last_seen_at IS NOT NULL
                  AND m_post.match_date IS NOT NULL
                  AND m_post.match_date > x.last_seen_at + INTERVAL '10 seconds'
                )
              )
          )
        ORDER BY x.current_ranking DESC
        LIMIT 1;

        IF v_anchor_low_a IS NOT NULL AND v_anchor_up_b IS NOT NULL THEN
          IF (v_anchor_low_a_rank - v_anchor_up_rank) <= (v_anchor_low_rank - v_anchor_up_b_rank) THEN
            v_anchor_low := v_anchor_low_a;
          ELSE
            v_anchor_up := v_anchor_up_b;
          END IF;
        ELSIF v_anchor_low_a IS NOT NULL THEN
          v_anchor_low := v_anchor_low_a;
        ELSIF v_anchor_up_b IS NOT NULL THEN
          v_anchor_up := v_anchor_up_b;
        ELSE
          v_anchor_up := NULL;
          v_anchor_low := NULL;
        END IF;
      END IF;

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
          sp_up.rating_anchor_record_no,
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
          x.rating_anchor_record_no IS NOT NULL
          OR (
            (v_anchor_up IS NULL OR x.rank_rating <= v_anchor_up)
            AND (v_anchor_low IS NULL OR x.rank_rating >= v_anchor_low)
          )
        )
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
          sp_low.rating_anchor_record_no,
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
          x.rating_anchor_record_no IS NOT NULL
          OR (
            (v_anchor_up IS NULL OR x.rank_rating <= v_anchor_up)
            AND (v_anchor_low IS NULL OR x.rank_rating >= v_anchor_low)
          )
        )
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

      IF p_current_ranking = 1
         OR v_up_a_rating IS NULL
         OR v_low_b_rating IS NULL
         OR v_up_a_rating >= v_low_b_rating THEN
        RETURN QUERY SELECT v_up_a_rating, v_up_a_rank, v_low_b_rating, v_low_b_rank;
        RETURN;
      END IF;

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
          sp_low.rating_anchor_record_no,
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
          x.rating_anchor_record_no IS NOT NULL
          OR (
            (v_anchor_up IS NULL OR x.rank_rating <= v_anchor_up)
            AND (v_anchor_low IS NULL OR x.rank_rating >= v_anchor_low)
          )
        )
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
          sp_up.rating_anchor_record_no,
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
          x.rating_anchor_record_no IS NOT NULL
          OR (
            (v_anchor_up IS NULL OR x.rank_rating <= v_anchor_up)
            AND (v_anchor_low IS NULL OR x.rank_rating >= v_anchor_low)
          )
        )
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
      v_max_bracket_dist INTEGER := 15;
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

      -- Require strict bracket fit (0 pts) when heuristic suspect exclusion was used,
      -- and <= 10 pts when bounded on both sides so inferred players never drift across hops.
      v_max_bracket_dist := CASE
        WHEN v_use_excluded THEN 0
        WHEN v_upper_bound IS NOT NULL AND v_lower_bound IS NOT NULL THEN 10
        ELSE 45
      END;

      IF v_match_count > 0
         AND v_bracket_dist IS NOT NULL
         AND v_bracket_dist <= v_max_bracket_dist
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
          IF v_player.rank_rating IS NOT NULL THEN
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

            UPDATE solare_players
            SET
              rank_rating = NULL,
              rating_is_estimated = FALSE,
              rating_achieved_record_no = NULL,
              updated_at = timezone('utc', now())
            WHERE region = v_player.region
              AND user_no = v_player.user_no
              AND rating_anchor_record_no IS NULL;

            RETURN TRUE;
          END IF;

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
    DO $$
    DECLARE
      v_rec RECORD;
      v_pass INTEGER;
    BEGIN
      CREATE TEMP TABLE tmp_solare_reset_players (
        region VARCHAR NOT NULL,
        user_no BIGINT NOT NULL,
        season SMALLINT NOT NULL,
        PRIMARY KEY (region, user_no)
      ) ON COMMIT DROP;

      INSERT INTO tmp_solare_reset_players (region, user_no, season)
      WITH region_latest AS MATERIALIZED (
        SELECT region, MAX(last_seen_at) AS max_seen_at
        FROM solare_players
        WHERE rating_anchor_record_no IS NOT NULL
        GROUP BY region
      ),
      seeded_anchors AS MATERIALIZED (
        SELECT DISTINCT ON (sp_a.region, COALESCE(sp_a.season, 9), sp_a.current_ranking)
          sp_a.region,
          COALESCE(sp_a.season, 9)::smallint AS season,
          sp_a.current_ranking,
          sp_a.rank_rating,
          sp_a.rating_anchor_record_no,
          sp_a.rating_achieved_record_no,
          sp_a.last_decay_at,
          sp_a.last_seen_at
        FROM solare_players sp_a
        WHERE sp_a.current_ranking IS NOT NULL
        ORDER BY
          sp_a.region,
          COALESCE(sp_a.season, 9),
          sp_a.current_ranking,
          sp_a.last_seen_at DESC NULLS LAST,
          sp_a.updated_at DESC NULLS LAST
      ),
      valid_anchors AS MATERIALIZED (
        SELECT
          sa.region,
          sa.season,
          sa.current_ranking,
          sa.rank_rating
        FROM seeded_anchors sa
        INNER JOIN region_latest rl ON rl.region = sa.region
        WHERE sa.rating_anchor_record_no IS NOT NULL
          AND COALESCE(sa.rating_achieved_record_no, sa.rating_anchor_record_no) = sa.rating_anchor_record_no
          AND sa.last_decay_at IS NULL
          AND sa.rank_rating IS NOT NULL
          AND (
            sa.last_seen_at IS NULL
            OR sa.last_seen_at >= rl.max_seen_at - INTERVAL '48 hours'
          )
      )
      SELECT DISTINCT ON (sp.region, sp.user_no)
        sp.region,
        sp.user_no,
        COALESCE(sp.season, 9)::smallint
      FROM solare_players sp
      INNER JOIN solare_player_rating_events e
        ON e.region = sp.region
       AND e.user_no = sp.user_no
       AND e.event_type = 'inferred_start'
       AND COALESCE(e.season, 9) = COALESCE(sp.season, 9)
      LEFT JOIN LATERAL (
        SELECT va.rank_rating
        FROM valid_anchors va
        WHERE va.region = sp.region
          AND va.season = COALESCE(sp.season, 9)::smallint
          AND va.current_ranking < sp.current_ranking
        ORDER BY va.current_ranking DESC
        LIMIT 1
      ) a_up ON TRUE
      LEFT JOIN LATERAL (
        SELECT va.rank_rating
        FROM valid_anchors va
        WHERE va.region = sp.region
          AND va.season = COALESCE(sp.season, 9)::smallint
          AND va.current_ranking > sp.current_ranking
          AND (a_up.rank_rating IS NULL OR va.rank_rating <= a_up.rank_rating)
        ORDER BY va.current_ranking ASC
        LIMIT 1
      ) a_low ON TRUE
      WHERE sp.rating_anchor_record_no IS NULL
        AND sp.user_no IS NOT NULL
        AND sp.current_ranking IS NOT NULL
        AND sp.current_ranking >= 1
        AND (
          (
            (e.metadata->>'upper_bound') IS NOT NULL
            AND e.new_rating > GREATEST((e.metadata->>'upper_bound')::int, COALESCE((e.metadata->>'lower_bound')::int, (e.metadata->>'upper_bound')::int)) + 10
          )
          OR (
            (e.metadata->>'lower_bound') IS NOT NULL
            AND e.new_rating < LEAST((e.metadata->>'lower_bound')::int, COALESCE((e.metadata->>'upper_bound')::int, (e.metadata->>'lower_bound')::int)) - 10
          )
          OR (
            COALESCE((e.metadata->>'excluded_practice_suspects')::int, 0) > 0
            AND (
              (e.metadata->>'upper_bound') IS NULL
              OR (e.metadata->>'lower_bound') IS NULL
              OR e.new_rating > (e.metadata->>'upper_bound')::int
              OR e.new_rating < (e.metadata->>'lower_bound')::int
            )
          )
          OR (a_up.rank_rating IS NOT NULL AND sp.rank_rating > a_up.rank_rating)
          OR (a_low.rank_rating IS NOT NULL AND sp.rank_rating < a_low.rank_rating)
        );

      -- Reset all identified drifted players first
      FOR v_rec IN
        SELECT region, user_no, season
        FROM tmp_solare_reset_players
      LOOP
        DELETE FROM solare_player_rating_events e
        WHERE e.region = v_rec.region
          AND e.user_no = v_rec.user_no
          AND e.event_type = 'inferred_start'
          AND COALESCE(e.season, 9) = v_rec.season
          AND e.id > COALESCE((
            SELECT MAX(ep.id)
            FROM solare_player_rating_events ep
            WHERE ep.region = v_rec.region
              AND ep.user_no = v_rec.user_no
              AND ep.event_type IN ('season_reset', 'seed_anchor', 'reconcile')
          ), 0);

        UPDATE solare_players
        SET
          rank_rating = NULL,
          rating_is_estimated = FALSE,
          rating_achieved_record_no = NULL,
          updated_at = timezone('utc', now())
        WHERE region = v_rec.region
          AND user_no = v_rec.user_no
          AND rating_anchor_record_no IS NULL;
      END LOOP;

      -- Re-evaluate all unseeded/estimated players AND all reset players across 2 passes
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
                FROM tmp_solare_reset_players tr
                WHERE tr.region = sp.region
                  AND tr.user_no = sp.user_no
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

      UPDATE solare_player_wl_checkpoints cp
      SET
        checkpoint_rating = sp.rank_rating,
        checkpoint_rating_is_estimated = COALESCE(sp.rating_is_estimated, FALSE),
        updated_at = timezone('utc', now())
      FROM solare_players sp
      WHERE cp.region = sp.region
        AND cp.user_no = sp.user_no
        AND cp.season = COALESCE(sp.season, 9)::smallint
        AND (
          cp.checkpoint_rating IS DISTINCT FROM sp.rank_rating
          OR cp.checkpoint_rating_is_estimated IS DISTINCT FROM COALESCE(sp.rating_is_estimated, FALSE)
        )
        AND cp.checkpoint_record_no = (
          SELECT MAX(cp2.checkpoint_record_no)
          FROM solare_player_wl_checkpoints cp2
          WHERE cp2.region = sp.region
            AND cp2.user_no = sp.user_no
            AND cp2.season = COALESCE(sp.season, 9)::smallint
        )
        AND cp.checkpoint_record_no >= GREATEST(
          COALESCE(sp.rating_achieved_record_no, 0),
          COALESCE(sp.rating_anchor_record_no, 0)
        )
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
        );
    END;
    $$;
  `);
};

exports.down = () => {
  // No-op: retains seed-anchor-bounded neighbor selection and inference rules.
};
