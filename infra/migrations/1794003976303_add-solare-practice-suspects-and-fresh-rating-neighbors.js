/**
 * Non-destructive Practice Mode suspect flags + fresh rating neighbors in rating inference.
 *
 * Why flag instead of delete:
 * - When the Ranked queue opens, Practice Mode and Ranked matches can interleave in `record_no`,
 *   and neither `record_no` nor crawl timestamp separates the two modes with 100% certainty.
 * - Deleting by time window could remove legitimate Ranked matches.
 *
 * How suspect flags are used:
 * - `fn_infer_unseeded_solare_player_rating` only ignores a player's suspect matches when doing so
 *   brings the DB W/L/D strictly closer to the official W/L/D (`solare_players`) WITHOUT leaving any
 *   excess and within at most 2 games of difference. Otherwise, all matches remain counted.
 * - Zero rows are deleted from `solare_matches` or `solare_match_players`.
 *
 * Fresh rating neighbors:
 * - When two rows in `solare_players` share the same `current_ranking` (one stale from a player who
 *   dropped out of the leaderboard), only the most recently seen row (`last_seen_at`) is used.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS solare_practice_suspect_matches (
      region varchar(8) NOT NULL,
      record_no bigint NOT NULL,
      reason varchar(32) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
      PRIMARY KEY (region, record_no)
    );
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_refresh_solare_practice_suspects(
      p_region VARCHAR,
      p_min_record_no BIGINT DEFAULT 0
    )
    RETURNS INTEGER AS $$
    DECLARE
      v_inserted INTEGER;
    BEGIN
      DELETE FROM solare_practice_suspect_matches
      WHERE region = p_region
        AND record_no >= COALESCE(p_min_record_no, 0);

      WITH room_stats AS (
        SELECT
          m.record_no,
          m.match_date,
          NULLIF(TRIM(m.repz_download_url), '') IS NOT NULL AS has_repz,
          BOOL_OR(mp.is_winner) AS has_winner,
          COUNT(*) FILTER (
            WHERE mp.vary_rank_rating IS NOT NULL
              AND mp.vary_rank_rating <> 0
              AND ABS(mp.vary_rank_rating) <> 35
          ) AS valid_pdl_count,
          MAX(ABS(mp.vary_rank_rating)) FILTER (
            WHERE mp.vary_rank_rating IS NOT NULL
              AND mp.vary_rank_rating <> 0
              AND ABS(mp.vary_rank_rating) <> 35
          ) AS max_abs_pdl
        FROM solare_matches m
        JOIN solare_match_players mp
          ON mp.region = m.region AND mp.record_no = m.record_no
        WHERE m.region = p_region
        GROUP BY m.record_no, m.match_date, m.repz_download_url
      ),
      repz_intervals AS (
        SELECT
          record_no AS prev_repz,
          match_date AS prev_date,
          LEAD(record_no) OVER (ORDER BY record_no) AS next_repz,
          LEAD(match_date) OVER (ORDER BY record_no) AS next_date
        FROM room_stats
        WHERE has_repz
      ),
      -- Matches without .repz between two Ranked sessions (overnight queue closure >= 6h between adjacent .repz matches)
      overnight_gap AS (
        SELECT rs.record_no, 'overnight_gap'::varchar(32) AS reason
        FROM room_stats rs
        JOIN repz_intervals ri
          ON rs.record_no > ri.prev_repz
         AND rs.record_no < ri.next_repz
        WHERE NOT rs.has_repz
          AND ri.next_date - ri.prev_date >= INTERVAL '6 hours'
      ),
      -- Full low-PDL lobby (>= 3 resolved players and all with |PDL| <= 15)
      low_pdl_room AS (
        SELECT record_no, 'low_pdl_room'::varchar(32) AS reason
        FROM room_stats
        WHERE NOT has_repz
          AND has_winner
          AND valid_pdl_count >= 3
          AND max_abs_pdl <= 15
      ),
      -- Premade trio (Ranked is strictly Solo Queue): identical 3-player team in 2+ nearby non-.repz matches
      team_keys AS (
        SELECT
          mp.record_no,
          mp.team,
          STRING_AGG(LOWER(mp.user_nickname), '|' ORDER BY LOWER(mp.user_nickname)) AS team_key,
          COUNT(*) AS team_size
        FROM solare_match_players mp
        JOIN room_stats rs
          ON rs.record_no = mp.record_no
        WHERE mp.region = p_region
          AND NOT rs.has_repz
        GROUP BY mp.record_no, mp.team
      ),
      premade_trio AS (
        SELECT DISTINCT a.record_no, 'premade_trio'::varchar(32) AS reason
        FROM team_keys a
        JOIN team_keys b
          ON b.team_key = a.team_key
         AND b.record_no <> a.record_no
         AND ABS(b.record_no - a.record_no) <= 300
        WHERE a.team_size = 3
          AND b.team_size = 3
      ),
      all_suspects AS (
        SELECT record_no, reason FROM low_pdl_room
        UNION ALL
        SELECT record_no, reason FROM premade_trio
        UNION ALL
        SELECT record_no, reason FROM overnight_gap
      )
      INSERT INTO solare_practice_suspect_matches (region, record_no, reason)
      SELECT p_region, record_no, reason
      FROM all_suspects
      WHERE record_no >= COALESCE(p_min_record_no, 0)
      ON CONFLICT (region, record_no) DO NOTHING;

      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      RETURN v_inserted;
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
      v_stats RECORD;
      v_use_excluded BOOLEAN := FALSE;
      v_dist_full INTEGER;
      v_dist_excl INTEGER;
      v_total_delta INTEGER;
      v_max_record_no BIGINT;
      v_match_count INTEGER;
      v_upper_bound INTEGER;
      v_lower_bound INTEGER;
      v_inferred RECORD;
    BEGIN
      SELECT
        region,
        user_no,
        user_nickname,
        season,
        current_ranking,
        rank_rating,
        rating_anchor_record_no,
        win_count,
        lose_count,
        draw_count
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

      IF v_player.rank_rating IS NOT NULL THEN
        SELECT EXISTS (
          SELECT 1
          FROM solare_player_rating_events
          WHERE region = v_player.region
            AND user_no = v_player.user_no
            AND event_type = 'inferred_start'
        ) INTO v_has_inferred_event;

        IF NOT v_has_inferred_event THEN
          RETURN FALSE;
        END IF;
      END IF;

      WITH player_matches AS (
        SELECT
          mp.record_no,
          mp.vary_rank_rating,
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
          (ps.record_no IS NOT NULL) AS is_suspect
        FROM solare_match_players mp
        LEFT JOIN solare_matches m
          ON m.region = mp.region AND m.record_no = mp.record_no
        LEFT JOIN solare_practice_suspect_matches ps
          ON ps.region = mp.region AND ps.record_no = mp.record_no
        WHERE mp.region = v_player.region
          AND (
            m.season IS NULL
            OR v_player.season IS NULL
            OR m.season = v_player.season
          )
          AND (
            (v_player.user_no IS NOT NULL AND mp.user_no = v_player.user_no)
            OR ((v_player.user_no IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER(v_player.user_nickname))
          )
      )
      SELECT
        COUNT(*) FILTER (WHERE outcome = 'w')::integer AS full_w,
        COUNT(*) FILTER (WHERE outcome = 'l')::integer AS full_l,
        COUNT(*) FILTER (WHERE outcome = 'd')::integer AS full_d,
        COUNT(*) FILTER (WHERE outcome = 'w' AND NOT is_suspect)::integer AS excl_w,
        COUNT(*) FILTER (WHERE outcome = 'l' AND NOT is_suspect)::integer AS excl_l,
        COUNT(*) FILTER (WHERE outcome = 'd' AND NOT is_suspect)::integer AS excl_d,
        COUNT(*) FILTER (WHERE is_suspect)::integer AS suspect_count
      INTO v_stats
      FROM player_matches;

      -- Only ignore suspect matches when doing so brings DB W/L/D strictly closer to official counts,
      -- leaving zero excess and at most 2 games of difference.
      IF v_stats.suspect_count > 0 THEN
        v_dist_full :=
          ABS(v_stats.full_w - COALESCE(v_player.win_count, 0))
          + ABS(v_stats.full_l - COALESCE(v_player.lose_count, 0))
          + ABS(v_stats.full_d - COALESCE(v_player.draw_count, 0));
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
      WHERE mp.region = v_player.region
        AND mp.vary_rank_rating IS NOT NULL
        AND mp.vary_rank_rating <> 0
        AND (
          m.season IS NULL
          OR v_player.season IS NULL
          OR m.season = v_player.season
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

      IF v_match_count = 0 OR v_max_record_no IS NULL THEN
        RETURN FALSE;
      END IF;

      -- Deduplicate each ranking slot by the most recently seen player row (ignore stale duplicates)
      SELECT x.rank_rating
      INTO v_upper_bound
      FROM (
        SELECT DISTINCT ON (sp_up.current_ranking)
          sp_up.current_ranking,
          sp_up.rank_rating
        FROM solare_players sp_up
        WHERE sp_up.region = v_player.region
          AND sp_up.user_no <> v_player.user_no
          AND sp_up.current_ranking IS NOT NULL
          AND sp_up.current_ranking < v_player.current_ranking
          AND (
            sp_up.season = COALESCE(v_player.season, 9)
            OR (COALESCE(v_player.season, 9) = 9 AND sp_up.season IS NULL)
          )
        ORDER BY
          sp_up.current_ranking DESC,
          sp_up.last_seen_at DESC NULLS LAST,
          sp_up.updated_at DESC NULLS LAST
      ) x
      WHERE x.rank_rating IS NOT NULL
      ORDER BY x.current_ranking DESC
      LIMIT 1;

      SELECT x.rank_rating
      INTO v_lower_bound
      FROM (
        SELECT DISTINCT ON (sp_low.current_ranking)
          sp_low.current_ranking,
          sp_low.rank_rating
        FROM solare_players sp_low
        WHERE sp_low.region = v_player.region
          AND sp_low.user_no <> v_player.user_no
          AND sp_low.current_ranking IS NOT NULL
          AND sp_low.current_ranking > v_player.current_ranking
          AND (
            sp_low.season = COALESCE(v_player.season, 9)
            OR (COALESCE(v_player.season, 9) = 9 AND sp_low.season IS NULL)
          )
        ORDER BY
          sp_low.current_ranking ASC,
          sp_low.last_seen_at DESC NULLS LAST,
          sp_low.updated_at DESC NULLS LAST
      ) x
      WHERE x.rank_rating IS NOT NULL
      ORDER BY x.current_ranking ASC
      LIMIT 1;

      IF (v_player.current_ranking > 1 AND (v_upper_bound IS NULL OR v_lower_bound IS NULL))
         OR (v_player.current_ranking = 1 AND v_lower_bound IS NULL) THEN
        RETURN FALSE;
      END IF;

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
      INTO v_inferred
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

      IF v_inferred IS NULL OR v_inferred.bracket_distance > 45 THEN
        RETURN FALSE;
      END IF;

      DELETE FROM solare_player_rating_events
      WHERE region = v_player.region
        AND user_no = v_player.user_no
        AND event_type = 'inferred_start';

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
        v_inferred.base_rating,
        v_inferred.candidate_rating,
        v_total_delta,
        v_max_record_no,
        jsonb_build_object(
          'inferred_start_rating', v_inferred.base_rating,
          'total_delta', v_total_delta,
          'upper_bound', v_upper_bound,
          'lower_bound', v_lower_bound,
          'excluded_practice_suspects', CASE WHEN v_use_excluded THEN v_stats.suspect_count ELSE 0 END
        )
      );

      UPDATE solare_players
      SET
        rank_rating = v_inferred.candidate_rating,
        rating_achieved_record_no = v_max_record_no,
        rating_achieved_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
      WHERE region = v_player.region
        AND user_no = v_player.user_no;

      RETURN TRUE;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = false;
