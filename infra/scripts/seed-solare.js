import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import { runner } from "node-pg-migrate";
import database from "../database.js";

if (fs.existsSync(".env")) {
  dotenvExpand.expand(dotenv.config());
}

async function seedSolare() {
  const isAddMatchOnly = process.argv.includes("--match");
  const isLoss = process.argv.includes("--loss");

  const client = await database.getNewClient();

  try {
    await runner({
      dir: path.resolve("infra", "migrations"),
      direction: "up",
      log: () => {},
      migrationsTable: "pgmigrations",
      dbClient: client,
      dryRun: false,
    });

    await client.query("BEGIN;");

    // Upsert Okazaki in solare_players
    await client.query({
      text: `
        INSERT INTO solare_players (
          region,
          season,
          user_no,
          user_nickname,
          current_ranking,
          class_type,
          skill_branch_type,
          win_count,
          lose_count,
          draw_count,
          win_average
        )
        VALUES ('SA', 9, 777001, 'Okazaki', 65, 20, 2, 79, 50, 0, '61.25%')
        ON CONFLICT (region, user_no)
        DO UPDATE SET
          season = EXCLUDED.season,
          user_nickname = EXCLUDED.user_nickname,
          current_ranking = EXCLUDED.current_ranking,
          class_type = EXCLUDED.class_type,
          skill_branch_type = EXCLUDED.skill_branch_type,
          win_count = CASE
            WHEN $1::boolean AND NOT $2::boolean THEN solare_players.win_count + 1
            ELSE EXCLUDED.win_count
          END,
          lose_count = CASE
            WHEN $1::boolean AND $2::boolean THEN solare_players.lose_count + 1
            ELSE EXCLUDED.lose_count
          END,
          updated_at = timezone('utc', now())
        ;`,
      values: [isAddMatchOnly, isLoss],
    });

    if (!isAddMatchOnly) {
      // Seed 5 initial matches for Okazaki
      const initialMatches = [
        {
          record_no: 930001,
          is_winner: true,
          vary_rank_rating: 26,
          kills: 4,
          deaths: 2,
          cc: 10,
          dmg: 185000,
          taken: 140000,
          heal: 95000,
        },
        {
          record_no: 930002,
          is_winner: false,
          vary_rank_rating: -22,
          kills: 2,
          deaths: 3,
          cc: 7,
          dmg: 145000,
          taken: 165000,
          heal: 88000,
        },
        {
          record_no: 930003,
          is_winner: true,
          vary_rank_rating: 25,
          kills: 5,
          deaths: 1,
          cc: 12,
          dmg: 220000,
          taken: 130000,
          heal: 110000,
        },
        {
          record_no: 930004,
          is_winner: true,
          vary_rank_rating: 25,
          kills: 5,
          deaths: 2,
          cc: 11,
          dmg: 214000,
          taken: 138000,
          recovery: 96000,
        },
      ];

      for (const m of initialMatches) {
        await client.query({
          text: `
            INSERT INTO solare_matches (region, season, record_no, play_time_seconds, win_record, match_date)
            VALUES ('SA', 9, $1, 300, '{2,2,3,2}', timezone('utc', now()))
            ON CONFLICT (region, record_no) DO NOTHING
            ;`,
          values: [m.record_no],
        });

        await client.query({
          text: `
            INSERT INTO solare_match_players (
              region,
              record_no,
              team,
              user_nickname,
              user_no,
              class_type,
              skill_branch_type,
              kill_count,
              death_count,
              cc_applied_count,
              damage_done,
              damage_taken,
              recovery,
              is_winner,
              vary_rank_rating
            )
            VALUES ('SA', $1, 0, 'Okazaki', 777001, 20, 2, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (region, record_no, user_nickname) DO NOTHING
            ;`,
          values: [
            m.record_no,
            m.kills,
            m.deaths,
            m.cc,
            m.dmg,
            m.taken,
            m.recovery || m.heal,
            m.is_winner,
            m.vary_rank_rating,
          ],
        });
      }

      await client.query("COMMIT;");
      console.log(
        "✅ Solare test data seeded! Player 'Okazaki' (SA) is ready with 4 matches (#930001-#930004).",
      );
    } else {
      // Find max record_no and insert 1 new match to simulate a live game finishing
      const maxRes = await client.query(`
        SELECT COALESCE(MAX(record_no), 930004)::bigint AS max_rec
        FROM solare_match_players
        WHERE region = 'SA' AND LOWER(user_nickname) = 'okazaki'
      `);
      const nextRecordNo = Number(maxRes.rows[0].max_rec) + 1;
      const isWinner = !isLoss;
      const baseDelta = isWinner ? 26 : -21;

      await client.query({
        text: `
          INSERT INTO solare_matches (region, season, record_no, play_time_seconds, win_record, match_date)
          VALUES ('SA', 9, $1, 315, '{2,2,3,2}', timezone('utc', now()))
          ON CONFLICT (region, record_no) DO NOTHING
          ;`,
        values: [nextRecordNo],
      });

      await client.query({
        text: `
          INSERT INTO solare_match_players (
            region,
            record_no,
            team,
            user_nickname,
            user_no,
            class_type,
            skill_branch_type,
            kill_count,
            death_count,
            cc_applied_count,
            damage_done,
            damage_taken,
            recovery,
            is_winner,
            vary_rank_rating
          )
          VALUES ('SA', $1, 0, 'Okazaki', 777001, 20, 2, $2, $3, 12, 235000, 128000, 108000, $4, $5)
          ;`,
        values: [
          nextRecordNo,
          isWinner ? 6 : 2,
          isWinner ? 1 : 3,
          isWinner,
          baseDelta,
        ],
      });

      await client.query("COMMIT;");
      console.log(
        `⚔️ Simulated new match #${nextRecordNo} for 'Okazaki' (SA): ${isWinner ? "VICTORY (+26 base PDL)" : "DEFEAT (-21 PDL)"}! Watch your OBS overlay update within 20s.`,
      );
    }
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("❌ Error seeding Solare test data:", err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await seedSolare();
