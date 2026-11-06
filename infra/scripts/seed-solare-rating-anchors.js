import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import { runner } from "node-pg-migrate";
import database from "../database.js";

if (fs.existsSync(".env")) {
  dotenvExpand.expand(dotenv.config());
}

const DEFAULT_SEED_PATH = path.resolve(
  "infra",
  "seeds",
  "solare-rating-anchors.json",
);

export async function seedSolareRatingAnchors(options = {}) {
  const fileArgIdx = process.argv.indexOf("--file");
  const seedFilePath =
    options.seedFilePath ||
    (fileArgIdx !== -1 && process.argv[fileArgIdx + 1]
      ? path.resolve(process.argv[fileArgIdx + 1])
      : DEFAULT_SEED_PATH);

  const regionArgIdx = process.argv.indexOf("--region");
  const requestedRegions =
    options.requestedRegions ||
    (regionArgIdx !== -1 && process.argv[regionArgIdx + 1]
      ? process.argv[regionArgIdx + 1]
          .split(",")
          .map((r) => r.trim().toUpperCase())
          .filter(Boolean)
      : null);

  const force =
    options.force !== undefined
      ? Boolean(options.force)
      : process.argv.includes("--force");

  if (!fs.existsSync(seedFilePath)) {
    if (options.client) {
      return { updatedCount: 0, eventsCount: 0, totalAnchors: 0 };
    }
    throw new Error(`Seed file not found at ${seedFilePath}.`);
  }

  const seedData = JSON.parse(fs.readFileSync(seedFilePath, "utf8"));
  const defaultSeason = Number(seedData.season) || 9;
  const snapshotDate = seedData.snapshot_date || null;
  const rawAnchors = Array.isArray(seedData.anchors) ? seedData.anchors : [];

  const validAnchors = rawAnchors
    .map((entry) => {
      const region = String(entry.region || "SA")
        .trim()
        .toUpperCase();
      const userNickname = String(entry.user_nickname || "").trim();
      const rankRating = Number(entry.rank_rating);

      if (!userNickname || !Number.isInteger(rankRating) || rankRating < 0) {
        return null;
      }

      if (requestedRegions && !requestedRegions.includes(region)) {
        return null;
      }

      return {
        region,
        user_nickname: userNickname,
        rank_rating: rankRating,
        anchor_record_no:
          entry.anchor_record_no !== undefined &&
          entry.anchor_record_no !== null
            ? Number(entry.anchor_record_no)
            : null,
        win_count: Number.isInteger(entry.win_count) ? entry.win_count : null,
        lose_count: Number.isInteger(entry.lose_count)
          ? entry.lose_count
          : null,
        draw_count: Number.isInteger(entry.draw_count)
          ? entry.draw_count
          : null,
      };
    })
    .filter(Boolean);

  if (validAnchors.length === 0) {
    console.log("⚠️ No anchors found to seed.");
    return { updatedCount: 0, eventsCount: 0, totalAnchors: 0 };
  }

  const externalClient = Boolean(options.client);
  const client = options.client || (await database.getNewClient());

  try {
    if (!externalClient) {
      await runner({
        dir: path.resolve("infra", "migrations"),
        direction: "up",
        log: () => {},
        migrationsTable: "pgmigrations",
        dbClient: client,
        dryRun: false,
      });

      await client.query("BEGIN;");
    }

    const bulkRes = await client.query({
      text: `
        WITH deduped_anchors AS (
          SELECT DISTINCT ON (UPPER(a.region), LOWER(a.user_nickname))
            UPPER(a.region) AS region,
            a.user_nickname,
            a.rank_rating,
            a.anchor_record_no,
            a.win_count AS anchor_wins,
            a.lose_count AS anchor_losses,
            COALESCE(a.draw_count, 0) AS anchor_draws
          FROM jsonb_to_recordset($1::jsonb) AS a(
            region text,
            user_nickname text,
            rank_rating integer,
            anchor_record_no bigint,
            win_count integer,
            lose_count integer,
            draw_count integer
          )
          ORDER BY
            UPPER(a.region),
            LOWER(a.user_nickname),
            a.rank_rating DESC
        ),
        input_anchors AS (
          SELECT
            da.*,
            ROW_NUMBER() OVER (
              PARTITION BY da.region
              ORDER BY da.rank_rating DESC, LOWER(da.user_nickname) ASC
            )::int AS anchor_region_rank
          FROM deduped_anchors da
        ),
        matched_players AS (
          SELECT DISTINCT ON (sp.region, sp.user_no)
            sp.region,
            sp.user_no,
            sp.user_nickname,
            COALESCE(sp.season, $2::smallint) AS season,
            sp.rank_rating AS previous_rating,
            sp.win_count AS db_wins,
            sp.lose_count AS db_losses,
            sp.draw_count AS db_draws,
            ia.rank_rating AS base_anchor_rating,
            ia.anchor_record_no AS explicit_anchor_record_no,
            ia.anchor_wins,
            ia.anchor_losses,
            ia.anchor_draws,
            ia.anchor_region_rank
          FROM input_anchors ia
          INNER JOIN solare_players sp
            ON sp.region = ia.region
            AND LOWER(sp.user_nickname) = LOWER(ia.user_nickname)
          WHERE $4::boolean = true
            OR (
              sp.rating_anchor_record_no IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM solare_player_rating_events e
                WHERE e.region = sp.region
                  AND e.user_no = sp.user_no
                  AND e.event_type = 'seed_anchor'
              )
            )
          ORDER BY
            sp.region,
            sp.user_no,
            sp.updated_at DESC
        ),
        resolved_watermarks AS (
          SELECT
            mp.region,
            mp.user_no,
            mp.user_nickname,
            mp.season,
            mp.previous_rating,
            mp.base_anchor_rating,
            mp.anchor_wins,
            mp.anchor_losses,
            mp.anchor_draws,
            COALESCE(m_stats.extra_games_count, 0)::int AS extra_games_since_snapshot,
            GREATEST(
              0,
              mp.base_anchor_rating + COALESCE(m_stats.post_anchor_delta_sum, 0)
            )::int AS effective_rating,
            CASE
              WHEN COALESCE(m_stats.latest_record_no, mp.explicit_anchor_record_no, 0) > 0
                THEN GREATEST(COALESCE(m_stats.latest_record_no, 0), COALESCE(mp.explicit_anchor_record_no, 0))
              ELSE NULL
            END AS final_anchor_watermark,
            CASE
              WHEN COALESCE(m_stats.achieved_record_no, mp.explicit_anchor_record_no, 0) > 0
                THEN COALESCE(m_stats.achieved_record_no, mp.explicit_anchor_record_no)
              ELSE NULL
            END AS achieved_record_no,
            COALESCE(m_stats.achieved_at, timezone('utc', now())) AS achieved_at
          FROM matched_players mp
          LEFT JOIN LATERAL (
            WITH ranked_matches AS (
              SELECT
                smp.record_no,
                smp.class_type,
                smp.is_winner,
                smp.vary_rank_rating,
                COALESCE(sm.match_date, sm.crawled_at, smp.created_at) AS match_at,
                ROW_NUMBER() OVER (ORDER BY smp.record_no DESC) AS rn_desc,
                COUNT(*) FILTER (WHERE smp.is_winner = true) OVER (
                  PARTITION BY smp.class_type
                  ORDER BY smp.record_no ASC
                )::int AS cum_cls_wins,
                COUNT(*) FILTER (WHERE smp.is_winner = false) OVER (
                  PARTITION BY smp.class_type
                  ORDER BY smp.record_no ASC
                )::int AS cum_cls_losses,
                COUNT(*) FILTER (WHERE smp.is_winner = true) OVER (
                  PARTITION BY smp.class_type
                )::int AS total_cls_wins,
                COUNT(*) FILTER (WHERE smp.is_winner = false) OVER (
                  PARTITION BY smp.class_type
                )::int AS total_cls_losses
              FROM solare_match_players smp
              LEFT JOIN solare_matches sm
                ON sm.region = smp.region AND sm.record_no = smp.record_no
              WHERE smp.region = mp.region
                AND (
                  smp.user_no = mp.user_no
                  OR LOWER(smp.user_nickname) = LOWER(mp.user_nickname)
                )
                AND smp.vary_rank_rating IS NOT NULL
                AND smp.vary_rank_rating <> 0
            ),
            inferred_extra AS (
              SELECT
                GREATEST(
                  0,
                  CASE
                    WHEN mp.explicit_anchor_record_no IS NOT NULL THEN
                      (
                        SELECT COUNT(*)::int
                        FROM ranked_matches rm
                        WHERE rm.record_no > mp.explicit_anchor_record_no
                      )
                    WHEN mp.anchor_wins IS NOT NULL
                      AND mp.anchor_losses IS NOT NULL
                      AND mp.anchor_region_rank <= 100
                      AND COALESCE(mp.db_wins, 0) >= mp.anchor_wins
                      AND (COALESCE(mp.db_losses, 0) + COALESCE(mp.db_draws, 0)) >= (mp.anchor_losses + mp.anchor_draws) THEN
                      (COALESCE(mp.db_wins, 0) - mp.anchor_wins) +
                      ((COALESCE(mp.db_losses, 0) + COALESCE(mp.db_draws, 0)) - (mp.anchor_losses + mp.anchor_draws))
                    WHEN mp.anchor_wins IS NOT NULL
                      AND mp.anchor_losses IS NOT NULL
                      AND mp.anchor_region_rank > 100 THEN
                      COALESCE(
                        (
                          SELECT
                            (rm.total_cls_wins - mp.anchor_wins) +
                            (rm.total_cls_losses - (mp.anchor_losses + mp.anchor_draws))
                          FROM ranked_matches rm
                          WHERE rm.cum_cls_wins = mp.anchor_wins
                            AND rm.cum_cls_losses = (mp.anchor_losses + mp.anchor_draws)
                            AND rm.total_cls_wins >= mp.anchor_wins
                            AND rm.total_cls_losses >= (mp.anchor_losses + mp.anchor_draws)
                          ORDER BY rm.record_no DESC
                          LIMIT 1
                        ),
                        0
                      )
                    ELSE 0
                  END
                )::int AS extra_games_count
            ),
            anchor_point AS (
              SELECT
                ie.extra_games_count,
                COALESCE(
                  mp.explicit_anchor_record_no,
                  CASE
                    WHEN ie.extra_games_count > 0 THEN
                      (
                        SELECT rm.record_no
                        FROM ranked_matches rm
                        WHERE rm.rn_desc = ie.extra_games_count + 1
                        LIMIT 1
                      )
                    ELSE
                      (SELECT MAX(rm.record_no) FROM ranked_matches rm)
                  END,
                  0
                )::bigint AS base_record_no,
                (SELECT COUNT(*)::int FROM ranked_matches) AS total_matches
              FROM inferred_extra ie
            )
            SELECT
              (SELECT MAX(rm.record_no)::bigint FROM ranked_matches rm) AS latest_record_no,
              (SELECT ap.extra_games_count FROM anchor_point ap) AS extra_games_count,
              COALESCE(
                (
                  SELECT SUM(rm.vary_rank_rating)::int
                  FROM ranked_matches rm, anchor_point ap
                  WHERE ap.total_matches > 0
                    AND rm.record_no > ap.base_record_no
                ),
                0
              ) AS post_anchor_delta_sum,
              COALESCE(
                (
                  SELECT MAX(rm.record_no)::bigint
                  FROM ranked_matches rm, anchor_point ap
                  WHERE ap.total_matches > 0
                    AND rm.record_no > ap.base_record_no
                ),
                (SELECT NULLIF(ap.base_record_no, 0) FROM anchor_point ap),
                (SELECT MAX(rm.record_no)::bigint FROM ranked_matches rm)
              ) AS achieved_record_no,
              (
                SELECT rm.match_at
                FROM ranked_matches rm
                ORDER BY rm.record_no DESC
                LIMIT 1
              ) AS achieved_at
          ) m_stats ON true
        ),
        updated_players AS (
          UPDATE solare_players sp
          SET
            rank_rating = rw.effective_rating,
            rating_anchor_record_no = rw.final_anchor_watermark,
            rating_achieved_record_no = rw.achieved_record_no,
            rating_achieved_at = rw.achieved_at,
            updated_at = timezone('utc', now())
          FROM resolved_watermarks rw
          WHERE sp.region = rw.region
            AND sp.user_no = rw.user_no
          RETURNING
            rw.region,
            rw.season,
            rw.user_no,
            rw.user_nickname,
            rw.previous_rating,
            rw.effective_rating,
            rw.final_anchor_watermark,
            rw.base_anchor_rating,
            rw.anchor_wins,
            rw.anchor_losses,
            rw.anchor_draws,
            rw.extra_games_since_snapshot
        ),
        inserted_events AS (
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
          SELECT
            up.region,
            up.season,
            up.user_no,
            up.user_nickname,
            'seed_anchor',
            up.previous_rating,
            up.effective_rating,
            CASE
              WHEN up.previous_rating IS NOT NULL THEN up.effective_rating - up.previous_rating
              ELSE 0
            END,
            up.final_anchor_watermark,
            jsonb_build_object(
              'snapshot_date', $3::text,
              'base_anchor_rating', up.base_anchor_rating,
              'anchor_wins', up.anchor_wins,
              'anchor_losses', up.anchor_losses,
              'anchor_draws', up.anchor_draws,
              'extra_games_fast_forwarded', up.extra_games_since_snapshot
            )
          FROM updated_players up
          WHERE up.previous_rating IS DISTINCT FROM up.effective_rating
          RETURNING id
        )
        SELECT
          (SELECT COUNT(*)::int FROM updated_players) AS updated_count,
          (SELECT COUNT(*)::int FROM inserted_events) AS events_count
        ;
      `,
      values: [
        JSON.stringify(validAnchors),
        defaultSeason,
        snapshotDate,
        force,
      ],
    });

    if (!externalClient) {
      await client.query("COMMIT;");
    }

    const updatedCount = bulkRes.rows[0]?.updated_count || 0;
    const eventsCount = bulkRes.rows[0]?.events_count || 0;
    const skippedCount = validAnchors.length - updatedCount;

    console.log(
      `✅ Solare rating anchors seeded in bulk! Updated: ${updatedCount} players (${eventsCount} rating events logged, ${skippedCount} already anchored or not yet in DB).`,
    );

    return {
      updatedCount,
      eventsCount,
      totalAnchors: validAnchors.length,
    };
  } catch (err) {
    if (!externalClient) {
      await client.query("ROLLBACK;");
      console.error("❌ Error seeding Solare rating anchors:", err);
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    if (!externalClient) {
      await client.end();
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await seedSolareRatingAnchors();
}
