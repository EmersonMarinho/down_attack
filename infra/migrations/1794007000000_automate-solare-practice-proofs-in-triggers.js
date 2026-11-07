/**
 * Automação completa das provas matemáticas de Modo Treino nos triggers e proteção de deltas Ranked.
 *
 * O que passa a acontecer automaticamente no PostgreSQL (sem apagar partidas e sem chamadas HTTP):
 * 1. `trg_solare_match_mode_proof_sync`:
 *    - Ao gravar uma prova `practice` em `solare_match_mode_proofs`, sincroniza
 *      `solare_practice_suspect_matches` (`math_proof`) e reverte imediatamente qualquer
 *      `match_delta` já aplicado em jogadores ancorados na mesma época/temporada (usando o delta
 *      efetivamente aplicado e restaurando `rating_achieved_record_no` / `rating_achieved_at`).
 *    - Ao invalidar (`DELETE`) ou alterar de `practice` para `ranked`, remove a suspeita e
 *      reaplica de forma idempotente os `match_delta` dos participantes ancorados.
 * 2. `fn_apply_solare_match_rating_delta`: ignora partidas provadas `practice` e partidas de outra
 *    temporada para nunca contaminar o `rank_rating` de jogadores ancorados/seeded.
 * 3. `fn_infer_unseeded_solare_player_rating`:
 *    - Sempre exclui partidas já provadas `practice` em `solare_match_mode_proofs`.
 *    - Usa apenas vizinhos com rating NÃO estimado (`NOT rating_is_estimated`) e sincronizados com o
 *      snapshot (`sem partida não-practice após last_seen_at + 10s`) como limites matemáticos.
 *    - Resolve `1..4` partidas excedentes (`<= 5000` combinações) em tempo real (`trigger_math`),
 *      verificando não-contradição (com fallback por nickname quando `user_no IS NULL`) e exigindo ao
 *      menos uma combinação válida 100% livre de contradição.
 *    - Jamais grava Elo exato (`rating_is_estimated = FALSE`) por soma bruta quando ainda restam
 *      partidas excedentes não resolvidas, caindo para interpolação segura entre vizinhos (`<= 40` pts).
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS solare_match_mode_proofs_region_mode_record_no_idx
    ON solare_match_mode_proofs (region, mode, record_no);
  `);

  pgm.sql(`
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

          IF v_ev.season IS NOT NULL
             AND v_player_season IS NOT NULL
             AND v_ev.season <> v_player_season THEN
            CONTINUE;
          END IF;

          SELECT MAX(e2.record_no)
          INTO v_prev_record_no
          FROM solare_player_rating_events e2
          WHERE e2.region = NEW.region
            AND e2.user_no = v_ev.user_no
            AND e2.record_no IS NOT NULL
            AND (v_epoch_id IS NULL OR e2.id >= v_epoch_id)
            AND (
              e2.season IS NULL
              OR v_player_season IS NULL
              OR e2.season = v_player_season
            );

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

      -- Apenas vizinhos com rating EXATO (não estimado) e sincronizados com o snapshot servem de limite duro
      SELECT x.rank_rating, x.current_ranking
      INTO v_upper_bound, v_upper_rank
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
        WHERE sp_up.region = v_player.region
          AND NOT (
            (v_player.user_no IS NOT NULL AND sp_up.user_no = v_player.user_no)
            OR (v_player.user_no IS NULL AND sp_up.user_no IS NULL AND LOWER(sp_up.user_nickname) = LOWER(v_player.user_nickname))
          )
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
            WHERE mp_post.region = v_player.region
              AND COALESCE(pr_post.mode, '') <> 'practice'
              AND (
                m_post.season IS NULL
                OR x.season IS NULL
                OR m_post.season = x.season
              )
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
      INTO v_lower_bound, v_lower_rank
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
        WHERE sp_low.region = v_player.region
          AND NOT (
            (v_player.user_no IS NOT NULL AND sp_low.user_no = v_player.user_no)
            OR (v_player.user_no IS NULL AND sp_low.user_no IS NULL AND LOWER(sp_low.user_nickname) = LOWER(v_player.user_nickname))
          )
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
            WHERE mp_post.region = v_player.region
              AND COALESCE(pr_post.mode, '') <> 'practice'
              AND (
                m_post.season IS NULL
                OR x.season IS NULL
                OR m_post.season = x.season
              )
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

      IF (v_player.current_ranking > 1 AND (v_upper_bound IS NULL OR v_lower_bound IS NULL))
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

      -- Prova combinatória em tempo real quando há pequeno excesso (1..4) e W/L/D sincronizado
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
              EXISTS (
                SELECT 1
                FROM solare_match_players mp2
                INNER JOIN solare_players sp2
                  ON sp2.region = mp2.region
                 AND (
                   (mp2.user_no IS NOT NULL AND sp2.user_no = mp2.user_no)
                   OR (mp2.user_no IS NULL AND LOWER(sp2.user_nickname) = LOWER(mp2.user_nickname))
                 )
                WHERE mp2.region = v_player.region
                  AND mp2.record_no = mp.record_no
                  AND NOT (
                    (v_player.user_no IS NOT NULL AND sp2.user_no = v_player.user_no)
                    OR (v_player.user_no IS NULL AND LOWER(sp2.user_nickname) = LOWER(v_player.user_nickname))
                  )
                  AND sp2.current_ranking IS NOT NULL
                  AND sp2.current_ranking >= 1
                  AND (
                    sp2.season = COALESCE(v_player.season, 9)
                    OR (COALESCE(v_player.season, 9) = 9 AND sp2.season IS NULL)
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
                        sp_newer.season = COALESCE(v_player.season, 9)
                        OR (COALESCE(v_player.season, 9) = 9 AND sp_newer.season IS NULL)
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
                        AND (
                          m_post.season IS NULL
                          OR sp2.season IS NULL
                          OR m_post.season = sp2.season
                        )
                        AND m_post.match_date IS NOT NULL
                        AND m_post.match_date > sp2.last_seen_at + INTERVAL '10 seconds'
                    )
                  )
                  AND (
                    SELECT COUNT(*)::int
                    FROM solare_match_players mp_cnt
                    LEFT JOIN solare_matches m_cnt
                      ON m_cnt.region = mp_cnt.region AND m_cnt.record_no = mp_cnt.record_no
                    LEFT JOIN solare_match_mode_proofs pr_cnt
                      ON pr_cnt.region = mp_cnt.region AND pr_cnt.record_no = mp_cnt.record_no
                    WHERE mp_cnt.region = sp2.region
                      AND (
                        (sp2.user_no IS NOT NULL AND mp_cnt.user_no = sp2.user_no)
                        OR ((sp2.user_no IS NULL OR mp_cnt.user_no IS NULL) AND LOWER(mp_cnt.user_nickname) = LOWER(sp2.user_nickname))
                      )
                      AND COALESCE(pr_cnt.mode, '') <> 'practice'
                      AND (
                        m_cnt.season IS NULL
                        OR sp2.season IS NULL
                        OR m_cnt.season = sp2.season
                      )
                      AND (
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
                        END
                      ) = (
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
                        END
                      )
                  ) <= (
                    CASE
                      WHEN mp2.is_winner THEN COALESCE(sp2.win_count, 0)
                      WHEN EXISTS (
                        SELECT 1
                        FROM solare_match_players w2
                        WHERE w2.region = mp2.region
                          AND w2.record_no = mp2.record_no
                          AND w2.is_winner
                      ) THEN COALESCE(sp2.lose_count, 0)
                      ELSE COALESCE(sp2.draw_count, 0)
                    END
                  )
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
                m.season IS NULL
                OR v_player.season IS NULL
                OR m.season = v_player.season
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
          )
          SELECT
            cs.valid_count,
            cs.uncontradicted_valid_count,
            cs.distinct_deltas,
            cs.sample_net_delta,
            COALESCE((SELECT ARRAY_AGG(rn ORDER BY rn) FROM mandatory_rns), ARRAY[]::bigint[]) AS mandatory_practice_rns
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
                  m.season IS NULL
                  OR v_player.season IS NULL
                  OR m.season = v_player.season
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
        -- Só ignora suspeitas heurísticas (não provadas) quando aproxima o W/L/D do oficial
        -- sem deixar excesso e com no máximo 2 jogos de diferença.
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

        -- Jamais inferir Elo exato por soma bruta quando ainda há excesso não resolvido pré-snapshot
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

      IF v_match_count > 0 AND v_bracket_dist IS NOT NULL AND v_bracket_dist <= 45 THEN
        v_final_rating := v_cand_rating;
        v_base_rating := v_cand_base;
        v_is_estimate := FALSE;
      ELSE
        -- Fallback: interpolação linear entre vizinhos exatos coerentes a até 40 pontos de distância
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
    BEGIN
      IF pg_trigger_depth() > 1 THEN
        RETURN NEW;
      END IF;

      IF NEW.current_ranking IS NOT NULL
         AND NEW.rating_anchor_record_no IS NULL
         AND (NEW.rank_rating IS NULL OR NEW.rating_is_estimated = TRUE) THEN
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
    AFTER INSERT OR UPDATE OF current_ranking, rank_rating, win_count, lose_count, draw_count
    ON solare_players
    FOR EACH ROW
    WHEN (
      NEW.current_ranking IS NOT NULL
      AND NEW.rating_anchor_record_no IS NULL
      AND (NEW.rank_rating IS NULL OR NEW.rating_is_estimated = TRUE)
    )
    EXECUTE FUNCTION fn_trg_solare_player_infer_rating();
  `);

  pgm.sql(`
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

      IF v_match_season IS NOT NULL
         AND v_player.season IS NOT NULL
         AND v_match_season <> v_player.season THEN
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
};

exports.down = false;
