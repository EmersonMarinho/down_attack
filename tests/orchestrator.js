import database from "~/infra/database";
import retry from "async-retry";
import { faker } from "@faker-js/faker";
import migrator from "~/server/utils/migrator.js";
import user from "~/server/utils/user.js";
import skills from "~/server/utils/skills.js";
import session from "~/server/utils/session.js";
import preset from "~/server/utils/preset.js";
import combo from "~/server/utils/combo.js";
import webserver from "~/infra/webserver.js";

async function waitForAllServices() {
  await waitForWebServer();

  async function waitForWebServer() {
    return retry(fetchStatuspage, {
      retries: 100,
      maxTimeout: 1000,
    });

    async function fetchStatuspage() {
      const response = await fetch(`${webserver.origin}/api/v1/status`);
      if (response.status !== 200) {
        throw Error();
      }
    }
  }
}

async function clearDatabase() {
  await database.query("drop schema public cascade; create schema public;");
}

async function runPendingMigrations() {
  await migrator.runPendingMigrations();
}

async function createUser(username) {
  const fakeUsername = username ? username : faker.internet.username();
  const fakeUserId = faker.string.numeric(18);
  const fakeAvatar = faker.string.alphanumeric(32);

  const userObject = {
    id: fakeUserId,
    username: fakeUsername,
    avatar: fakeAvatar,
    discriminator: "0",
    global_name: "Discord",
    public_flags: 131072,
  };

  return await user.create(userObject);
}

async function createSession(user) {
  const userId = user?.id || user;
  return await session.create(userId);
}

async function addFeaturesToUser(userObject, features) {
  const updatedUser = await user.addFeatures(userObject.id, features);

  return updatedUser;
}

async function createSkill(skillObject) {
  const defaultSkillObject = {
    id: 5608,
    name: `Aal's Dominion IV`,
    class_name: "Hashashin",
    skill_spec: "Absolute",
    crit_hit_rate: 100,
    is_floating: true,
    is_air_attack: true,
    pvp_damage: 58.48,
    cooldown: 7,
    hits: [
      {
        description: "1st hit",
        damage_percent: 2130,
        hit_count: 2,
        is_air_attack: true,
        is_floating: true,
      },
    ],
  };

  return await skills.create({
    ...defaultSkillObject,
    ...skillObject,
  });
}

async function createPreset(presetObject, user) {
  const defaultPresetObject = {
    class_name: "Hashashin",
    spec: "Awakening",
    is_public: true,
  };

  return await preset.create(
    {
      ...defaultPresetObject,
      ...presetObject,
    },
    user,
  );
}

async function createCombo(comboObject, user) {
  await createSkill(comboObject?.class_name);

  const defaultCombo = {
    name: "Valid Combo",
    class_name: "Hashashin",
    spec: "Awakening",
    skills: [
      {
        id: 5608,
        name: `Aal's Dominion IV`,
        hits: [],
      },
    ],
  };

  return await combo.create(
    {
      ...defaultCombo,
      ...comboObject,
    },
    user,
  );
}

async function createSolarePlayer(playerObject = {}) {
  const defaultPlayer = {
    region: "SA",
    season: 9,
    user_no: 49934,
    user_nickname: "Shxtey",
    current_ranking: 1,
    class_type: 12,
    skill_branch_type: 2,
    win_count: 89,
    lose_count: 61,
    draw_count: 0,
    win_average: "59.34%",
    download_count: 3,
  };

  const p = {
    ...defaultPlayer,
    ...playerObject,
  };

  const result = await database.query({
    text: `
      INSERT INTO solare_players (
        region, season, user_no, user_nickname, current_ranking, class_type,
        skill_branch_type, win_count, lose_count, draw_count,
        win_average, download_count, last_seen_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      ON CONFLICT (region, user_no) DO UPDATE SET
        season = EXCLUDED.season,
        user_nickname = EXCLUDED.user_nickname,
        current_ranking = EXCLUDED.current_ranking,
        class_type = EXCLUDED.class_type,
        skill_branch_type = EXCLUDED.skill_branch_type,
        win_count = EXCLUDED.win_count,
        lose_count = EXCLUDED.lose_count,
        draw_count = EXCLUDED.draw_count,
        win_average = EXCLUDED.win_average,
        download_count = EXCLUDED.download_count,
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING *;
    `,
    values: [
      p.region,
      p.season,
      p.user_no,
      p.user_nickname,
      p.current_ranking,
      p.class_type,
      p.skill_branch_type,
      p.win_count,
      p.lose_count,
      p.draw_count,
      p.win_average,
      p.download_count,
    ],
  });

  return result.rows[0];
}

async function createSolareMatch(matchObject = {}) {
  const region = matchObject.region || "SA";
  const season = matchObject.season ?? 9;
  const recordNo = matchObject.record_no ?? 920906;
  const targetNick = matchObject.user_nickname || "Shxtey";
  const targetUserNo = matchObject.user_no ?? 49934;
  const targetIsWinner =
    matchObject.is_winner !== undefined
      ? Boolean(matchObject.is_winner)
      : false;
  const targetVaryRating =
    matchObject.vary_rank_rating !== undefined
      ? matchObject.vary_rank_rating
      : targetIsWinner
        ? 26
        : -27;

  const defaultMatch = {
    region,
    season,
    record_no: recordNo,
    play_time_seconds: 227,
    win_record: targetIsWinner ? [2, 2, 2] : [3, 3, 3],
    repz_download_url: `https://replay.pearlcdn.com/sa/sa/solare_${season - 1}_${recordNo}_4b0d351e.repz`,
    match_date: new Date().toISOString(),
  };

  const defaultPlayers = [
    {
      team: 0,
      user_nickname: targetNick,
      user_no: targetUserNo,
      class_type: matchObject.class_type ?? 12,
      skill_branch_type: matchObject.skill_branch_type ?? 2,
      kill_count: matchObject.kill_count ?? 0,
      death_count: matchObject.death_count ?? 3,
      cc_applied_count: matchObject.cc_applied_count ?? 6,
      damage_done: matchObject.damage_done ?? 41439,
      damage_taken: matchObject.damage_taken ?? 99339,
      recovery: matchObject.recovery ?? 50174,
      is_winner: targetIsWinner,
      vary_rank_rating: targetVaryRating,
    },
    {
      team: 0,
      user_nickname: "Dislaik",
      user_no: 33878,
      class_type: 4,
      skill_branch_type: 1,
      kill_count: 0,
      death_count: 3,
      cc_applied_count: 12,
      damage_done: 69601,
      damage_taken: 92906,
      recovery: 47883,
      is_winner: targetIsWinner,
      vary_rank_rating: targetIsWinner ? 25 : -26,
    },
    {
      team: 0,
      user_nickname: "Konter",
      user_no: 237459,
      class_type: 16,
      skill_branch_type: 1,
      kill_count: 0,
      death_count: 3,
      cc_applied_count: 4,
      damage_done: 48232,
      damage_taken: 86319,
      recovery: 40681,
      is_winner: targetIsWinner,
      vary_rank_rating: targetIsWinner ? 25 : -26,
    },
    {
      team: 1,
      user_nickname: "Wisp",
      user_no: 252363,
      class_type: 8,
      skill_branch_type: 2,
      kill_count: 2,
      death_count: 0,
      cc_applied_count: 9,
      damage_done: 101139,
      damage_taken: 60741,
      recovery: 60346,
      is_winner: !targetIsWinner,
      vary_rank_rating: targetIsWinner ? -25 : 28,
    },
    {
      team: 1,
      user_nickname: "Shiuu",
      user_no: 1105130,
      class_type: 30,
      skill_branch_type: 2,
      kill_count: 3,
      death_count: 0,
      cc_applied_count: 12,
      damage_done: 92771,
      damage_taken: 59229,
      recovery: 58093,
      is_winner: !targetIsWinner,
      vary_rank_rating: targetIsWinner ? -24 : 31,
    },
    {
      team: 1,
      user_nickname: "Centauro01",
      user_no: 1515272,
      class_type: 25,
      skill_branch_type: 1,
      kill_count: 4,
      death_count: 0,
      cc_applied_count: 12,
      damage_done: 84654,
      damage_taken: 39302,
      recovery: 38471,
      is_winner: !targetIsWinner,
      vary_rank_rating: targetIsWinner ? -26 : 26,
    },
  ];

  const m = {
    ...defaultMatch,
    ...matchObject,
  };

  const matchRes = await database.query({
    text: `
      INSERT INTO solare_matches (
        region, season, record_no, play_time_seconds, win_record, repz_download_url, match_date, crawled_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (region, record_no) DO UPDATE SET
        season = EXCLUDED.season,
        play_time_seconds = EXCLUDED.play_time_seconds,
        win_record = EXCLUDED.win_record,
        repz_download_url = EXCLUDED.repz_download_url,
        match_date = EXCLUDED.match_date
      RETURNING *;
    `,
    values: [
      m.region,
      m.season,
      m.record_no,
      m.play_time_seconds,
      m.win_record,
      m.repz_download_url,
      m.match_date,
    ],
  });

  const playersToInsert = Array.isArray(matchObject.players)
    ? matchObject.players
    : defaultPlayers;

  const insertedPlayers = [];
  for (const p of playersToInsert) {
    const playerRes = await database.query({
      text: `
        INSERT INTO solare_match_players (
          region, record_no, team, user_nickname, user_no, class_type, skill_branch_type,
          kill_count, death_count, cc_applied_count, damage_done, damage_taken,
          recovery, is_winner, vary_rank_rating, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
        ON CONFLICT (region, record_no, user_nickname) DO UPDATE SET
          team = EXCLUDED.team,
          user_no = EXCLUDED.user_no,
          class_type = EXCLUDED.class_type,
          skill_branch_type = EXCLUDED.skill_branch_type,
          kill_count = EXCLUDED.kill_count,
          death_count = EXCLUDED.death_count,
          cc_applied_count = EXCLUDED.cc_applied_count,
          damage_done = EXCLUDED.damage_done,
          damage_taken = EXCLUDED.damage_taken,
          recovery = EXCLUDED.recovery,
          is_winner = EXCLUDED.is_winner,
          vary_rank_rating = EXCLUDED.vary_rank_rating
        RETURNING *;
      `,
      values: [
        m.region,
        m.record_no,
        p.team ?? 0,
        p.user_nickname || "Unknown",
        p.user_no ?? null,
        p.class_type ?? 12,
        p.skill_branch_type ?? 2,
        p.kill_count ?? 0,
        p.death_count ?? 0,
        p.cc_applied_count ?? 0,
        p.damage_done ?? 0,
        p.damage_taken ?? 0,
        p.recovery ?? 0,
        Boolean(p.is_winner),
        p.vary_rank_rating !== undefined ? p.vary_rank_rating : null,
      ],
    });
    insertedPlayers.push(playerRes.rows[0]);
  }

  return {
    ...matchRes.rows[0],
    players: insertedPlayers,
  };
}

const orchestrator = {
  waitForAllServices,
  clearDatabase,
  runPendingMigrations,
  createUser,
  createSession,
  addFeaturesToUser,
  createSkill,
  createPreset,
  createCombo,
  createSolarePlayer,
  createSolareMatch,
};

export default orchestrator;
