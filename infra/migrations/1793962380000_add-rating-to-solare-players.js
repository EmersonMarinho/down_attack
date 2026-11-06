exports.up = (pgm) => {
  pgm.addColumns(
    "solare_players",
    {
      rank_rating: {
        type: "integer",
        notNull: false,
      },
      rating_anchor_record_no: {
        type: "bigint",
        notNull: false,
      },
      rating_achieved_record_no: {
        type: "bigint",
        notNull: false,
      },
      rating_achieved_at: {
        type: "timestamptz",
        notNull: false,
      },
      last_decay_at: {
        type: "timestamptz",
        notNull: false,
      },
    },
    { ifNotExists: true },
  );

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS solare_players_region_rank_rating_tiebreaker_index
    ON solare_players (region, rank_rating DESC NULLS LAST, rating_achieved_record_no ASC NULLS LAST);
  `);

  pgm.createTable(
    "solare_player_rating_events",
    {
      id: {
        type: "bigserial",
        primaryKey: true,
      },
      region: {
        type: "varchar(8)",
        notNull: true,
      },
      season: {
        type: "smallint",
        notNull: false,
      },
      user_no: {
        type: "bigint",
        notNull: true,
      },
      user_nickname: {
        type: "varchar(64)",
        notNull: true,
      },
      event_type: {
        type: "varchar(32)",
        notNull: true,
      },
      previous_rating: {
        type: "integer",
        notNull: false,
      },
      new_rating: {
        type: "integer",
        notNull: true,
      },
      rating_delta: {
        type: "integer",
        notNull: true,
      },
      record_no: {
        type: "bigint",
        notNull: false,
      },
      metadata: {
        type: "jsonb",
        notNull: false,
      },
      created_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("timezone('utc', now())"),
      },
    },
    { ifNotExists: true },
  );

  pgm.createIndex(
    "solare_player_rating_events",
    ["region", "user_no", "created_at"],
    {
      name: "solare_player_rating_events_region_user_no_created_at_index",
      ifNotExists: true,
    },
  );

  pgm.createIndex(
    "solare_player_rating_events",
    ["region", "event_type", "created_at"],
    {
      name: "solare_player_rating_events_region_event_type_created_at_index",
      ifNotExists: true,
    },
  );

  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS solare_player_rating_events_unique_match_delta_idx
    ON solare_player_rating_events (region, user_no, record_no)
    WHERE event_type = 'match_delta' AND record_no IS NOT NULL;
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
        rating_anchor_record_no
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
        );

      IF v_match_count = 0 OR v_max_record_no IS NULL THEN
        RETURN FALSE;
      END IF;

      SELECT sp_up.rank_rating
      INTO v_upper_bound
      FROM solare_players sp_up
      WHERE sp_up.region = v_player.region
        AND sp_up.user_no <> v_player.user_no
        AND sp_up.current_ranking IS NOT NULL
        AND sp_up.current_ranking < v_player.current_ranking
        AND sp_up.rank_rating IS NOT NULL
        AND (
          sp_up.season = COALESCE(v_player.season, 9)
          OR (COALESCE(v_player.season, 9) = 9 AND sp_up.season IS NULL)
        )
      ORDER BY sp_up.current_ranking DESC, sp_up.rank_rating ASC
      LIMIT 1;

      SELECT sp_low.rank_rating
      INTO v_lower_bound
      FROM solare_players sp_low
      WHERE sp_low.region = v_player.region
        AND sp_low.user_no <> v_player.user_no
        AND sp_low.current_ranking IS NOT NULL
        AND sp_low.current_ranking > v_player.current_ranking
        AND sp_low.rank_rating IS NOT NULL
        AND (
          sp_low.season = COALESCE(v_player.season, 9)
          OR (COALESCE(v_player.season, 9) = 9 AND sp_low.season IS NULL)
        )
      ORDER BY sp_low.current_ranking ASC, sp_low.rank_rating DESC
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
          'lower_bound', v_lower_bound
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

    CREATE OR REPLACE FUNCTION fn_trg_solare_player_infer_rating()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.rank_rating IS NULL AND NEW.current_ranking IS NOT NULL THEN
        PERFORM fn_infer_unseeded_solare_player_rating(
          NEW.region,
          NEW.user_no,
          NEW.user_nickname
        );
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_solare_player_infer_rating ON solare_players;

    CREATE TRIGGER trg_solare_player_infer_rating
    AFTER INSERT OR UPDATE OF current_ranking, rank_rating
    ON solare_players
    FOR EACH ROW
    WHEN (NEW.rank_rating IS NULL AND NEW.current_ranking IS NOT NULL)
    EXECUTE FUNCTION fn_trg_solare_player_infer_rating();

    CREATE OR REPLACE FUNCTION fn_apply_solare_match_rating_delta()
    RETURNS TRIGGER AS $$
    DECLARE
      v_player RECORD;
      v_has_inferred_event BOOLEAN;
      v_match_at TIMESTAMPTZ;
      v_new_rating INTEGER;
      v_achieved_record_no BIGINT;
      v_inserted_id BIGINT;
    BEGIN
      IF NEW.vary_rank_rating IS NULL OR NEW.vary_rank_rating = 0 THEN
        RETURN NEW;
      END IF;

      SELECT
        user_no,
        user_nickname,
        season,
        current_ranking,
        rank_rating,
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
          FROM solare_player_rating_events
          WHERE region = NEW.region
            AND user_no = v_player.user_no
            AND event_type = 'inferred_start'
        ) INTO v_has_inferred_event;

        IF v_has_inferred_event THEN
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

      SELECT COALESCE(m.match_date, m.crawled_at, NEW.created_at, timezone('utc', now()))
      INTO v_match_at
      FROM solare_matches m
      WHERE m.region = NEW.region AND m.record_no = NEW.record_no
      LIMIT 1;

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

    DROP TRIGGER IF EXISTS trg_solare_match_player_rating_delta ON solare_match_players;

    CREATE TRIGGER trg_solare_match_player_rating_delta
    AFTER INSERT OR UPDATE OF vary_rank_rating, user_no
    ON solare_match_players
    FOR EACH ROW
    WHEN (NEW.vary_rank_rating IS NOT NULL AND NEW.vary_rank_rating <> 0)
    EXECUTE FUNCTION fn_apply_solare_match_rating_delta();
  `);
};

exports.down = false;
