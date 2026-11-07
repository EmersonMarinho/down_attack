import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import dotenvExpand from "dotenv-expand";
import database from "../database.js";
import { runMigrationsWithClient } from "../migrator.js";
import { seedSolareRatingAnchors } from "./seed-solare-rating-anchors.js";

if (fs.existsSync(".env")) {
  dotenvExpand.expand(dotenv.config());
}

async function runSeed() {
  if (!process.env.POSTGRES_HOST) {
    console.log("⚠️ No database environment variables found. Skipping seed.");
    return;
  }

  const seedsPath = path.resolve("infra", "seeds", "skills.json");
  const fileContent = await fsp.readFile(seedsPath, "utf-8");
  const skillsData = JSON.parse(fileContent);

  const presetsPath = path.resolve("infra", "seeds", "presets.json");
  let presetsData = [];
  if (fs.existsSync(presetsPath)) {
    const presetsContent = await fsp.readFile(presetsPath, "utf-8");
    presetsData = JSON.parse(presetsContent);
  }

  const allHits = [];
  for (const skill of skillsData) {
    if (Array.isArray(skill.hits)) {
      for (const hit of skill.hits) {
        allHits.push({
          skill_id: skill.id,
          ...hit,
        });
      }
    }
  }

  const client = await database.getNewClient();

  try {
    console.log("🔄 Running pending migrations before seed...");
    await runMigrationsWithClient(client, {
      dryRun: false,
    });

    console.log("🌱 Starting skills database seed...\n");
    const startTime = Date.now();

    await client.query("BEGIN;");

    // 1. Bulk upsert all skills in a single query
    await client.query(
      `
      INSERT INTO skills (
        id,
        name,
        command,
        class_name,
        skill_spec,
        cooldown,
        crit_hit_rate,
        pvp_damage,
        icon_path,
        is_sa,
        is_fg,
        is_if,
        is_down_attack,
        is_air_attack,
        is_down_smash,
        is_air_smash,
        is_knockback,
        is_knockdown,
        is_stun,
        is_floating,
        is_stiffness,
        is_bound,
        is_grapple,
        is_freezing,
        self_buffs,
        target_debuffs,
        tags
      )
      SELECT
        (item->>'id')::integer,
        item->>'name',
        item->>'command',
        item->>'class_name',
        item->>'skill_spec',
        COALESCE((item->>'cooldown')::numeric, 0),
        COALESCE((item->>'crit_hit_rate')::numeric, 0),
        COALESCE((item->>'pvp_damage')::numeric, 0),
        COALESCE(item->>'icon_path', '/icons/default_skill.webp'),
        COALESCE((item->>'is_sa')::boolean, false),
        COALESCE((item->>'is_fg')::boolean, false),
        COALESCE((item->>'is_if')::boolean, false),
        COALESCE((item->>'is_down_attack')::boolean, false),
        COALESCE((item->>'is_air_attack')::boolean, false),
        COALESCE((item->>'is_down_smash')::boolean, false),
        COALESCE((item->>'is_air_smash')::boolean, false),
        COALESCE((item->>'is_knockback')::boolean, false),
        COALESCE((item->>'is_knockdown')::boolean, false),
        COALESCE((item->>'is_stun')::boolean, false),
        COALESCE((item->>'is_floating')::boolean, false),
        COALESCE((item->>'is_stiffness')::boolean, false),
        COALESCE((item->>'is_bound')::boolean, false),
        COALESCE((item->>'is_grapple')::boolean, false),
        COALESCE((item->>'is_freezing')::boolean, false),
        COALESCE((item->'self_buffs')::jsonb, '[]'::jsonb),
        COALESCE((item->'target_debuffs')::jsonb, '{}'::jsonb),
        COALESCE((item->'tags')::jsonb, '[]'::jsonb)
      FROM jsonb_array_elements($1::jsonb) AS item
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        command = EXCLUDED.command,
        class_name = EXCLUDED.class_name,
        skill_spec = EXCLUDED.skill_spec,
        cooldown = EXCLUDED.cooldown,
        crit_hit_rate = EXCLUDED.crit_hit_rate,
        pvp_damage = EXCLUDED.pvp_damage,
        icon_path = EXCLUDED.icon_path,
        is_sa = EXCLUDED.is_sa,
        is_fg = EXCLUDED.is_fg,
        is_if = EXCLUDED.is_if,
        is_down_attack = EXCLUDED.is_down_attack,
        is_air_attack = EXCLUDED.is_air_attack,
        is_down_smash = EXCLUDED.is_down_smash,
        is_air_smash = EXCLUDED.is_air_smash,
        is_knockback = EXCLUDED.is_knockback,
        is_knockdown = EXCLUDED.is_knockdown,
        is_stun = EXCLUDED.is_stun,
        is_floating = EXCLUDED.is_floating,
        is_stiffness = EXCLUDED.is_stiffness,
        is_bound = EXCLUDED.is_bound,
        is_grapple = EXCLUDED.is_grapple,
        is_freezing = EXCLUDED.is_freezing,
        self_buffs = EXCLUDED.self_buffs,
        target_debuffs = EXCLUDED.target_debuffs,
        tags = EXCLUDED.tags,
        updated_at = timezone('utc', now());
    `,
      [JSON.stringify(skillsData)],
    );

    await client.query("DELETE FROM skills_hits;");

    if (allHits.length > 0) {
      await client.query(
        `
        INSERT INTO skills_hits (
          skill_id,
          description,
          damage_percent,
          hit_count,
          is_sa,
          is_fg,
          is_if,
          is_down_attack,
          is_air_attack,
          is_down_smash,
          is_air_smash,
          is_knockback,
          is_knockdown,
          is_stun,
          is_floating,
          is_stiffness,
          is_bound,
          is_grapple,
          is_freezing
        )
        SELECT
          (item->>'skill_id')::integer,
          item->>'description',
          COALESCE((item->>'damage_percent')::numeric, 0),
          COALESCE((item->>'hit_count')::integer, 1),
          COALESCE((item->>'is_sa')::boolean, false),
          COALESCE((item->>'is_fg')::boolean, false),
          COALESCE((item->>'is_if')::boolean, false),
          COALESCE((item->>'is_down_attack')::boolean, false),
          COALESCE((item->>'is_air_attack')::boolean, false),
          COALESCE((item->>'is_down_smash')::boolean, false),
          COALESCE((item->>'is_air_smash')::boolean, false),
          COALESCE((item->>'is_knockback')::boolean, false),
          COALESCE((item->>'is_knockdown')::boolean, false),
          COALESCE((item->>'is_stun')::boolean, false),
          COALESCE((item->>'is_floating')::boolean, false),
          COALESCE((item->>'is_stiffness')::boolean, false),
          COALESCE((item->>'is_bound')::boolean, false),
          COALESCE((item->>'is_grapple')::boolean, false),
          COALESCE((item->>'is_freezing')::boolean, false)
        FROM json_array_elements($1::json) AS item;
      `,
        [JSON.stringify(allHits)],
      );
    }

    if (presetsData.length > 0) {
      await client.query(
        `
        INSERT INTO presets (
          id,
          user_id,
          name,
          class_name,
          spec,
          hp,
          ap,
          aap,
          adventureap,
          adventureaap,
          mldr,
          radr,
          madr,
          acc,
          meev,
          raev,
          maev,
          bdrp,
          chrp,
          chc,
          abad,
          adad,
          aaad,
          is_public
        )
        SELECT
          (item->>'id')::uuid,
          (item->>'user_id')::uuid,
          item->>'name',
          item->>'class_name',
          item->>'spec',
          COALESCE((item->>'hp')::integer, 0),
          COALESCE((item->>'ap')::numeric, 0),
          COALESCE((item->>'aap')::numeric, 0),
          COALESCE((item->>'adventureap')::numeric, 0),
          COALESCE((item->>'adventureaap')::numeric, 0),
          COALESCE((item->>'mldr')::integer, 0),
          COALESCE((item->>'radr')::integer, 0),
          COALESCE((item->>'madr')::integer, 0),
          COALESCE((item->>'acc')::integer, 0),
          COALESCE((item->>'meev')::integer, 0),
          COALESCE((item->>'raev')::integer, 0),
          COALESCE((item->>'maev')::integer, 0),
          COALESCE((item->>'bdrp')::numeric, 0),
          COALESCE((item->>'chrp')::numeric, 0),
          COALESCE((item->>'chc')::numeric, 0),
          COALESCE((item->>'abad')::numeric, 0),
          COALESCE((item->>'adad')::numeric, 0),
          COALESCE((item->>'aaad')::numeric, 0),
          COALESCE((item->>'is_public')::boolean, true)
        FROM jsonb_array_elements($1::jsonb) AS item
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          class_name = EXCLUDED.class_name,
          spec = EXCLUDED.spec,
          hp = EXCLUDED.hp,
          ap = EXCLUDED.ap,
          aap = EXCLUDED.aap,
          adventureap = EXCLUDED.adventureap,
          adventureaap = EXCLUDED.adventureaap,
          mldr = EXCLUDED.mldr,
          radr = EXCLUDED.radr,
          madr = EXCLUDED.madr,
          acc = EXCLUDED.acc,
          meev = EXCLUDED.meev,
          raev = EXCLUDED.raev,
          maev = EXCLUDED.maev,
          bdrp = EXCLUDED.bdrp,
          chrp = EXCLUDED.chrp,
          chc = EXCLUDED.chc,
          abad = EXCLUDED.abad,
          adad = EXCLUDED.adad,
          aaad = EXCLUDED.aaad,
          is_public = EXCLUDED.is_public,
          updated_at = timezone('utc', now());
      `,
        [JSON.stringify(presetsData)],
      );
    }

    await seedSolareRatingAnchors({
      client,
      force: false,
    });

    await client.query("COMMIT;");

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `🚀 Success! ${skillsData.length} skills, ${allHits.length} hits, and ${presetsData.length} presets synchronized to the database in ${duration}s!`,
    );
  } catch (error) {
    await client.query("ROLLBACK;").catch(() => {});
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock_all();").catch(() => {});
    await client.end();
  }
}

runSeed().catch((error) => {
  console.error("\n❌ Error running seed:", error);
  process.exit(1);
});
