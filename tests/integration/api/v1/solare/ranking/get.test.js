import orchestrator from "tests/orchestrator.js";
import webserver from "~~/infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

describe("GET /api/v1/solare/ranking", () => {
  describe("Anonymous user", () => {
    test("With invalid region, season, or class_type", async () => {
      const invalidRegionRes = await fetch(
        `${webserver.origin}/api/v1/solare/ranking?region=INVALID`,
      );
      expect(invalidRegionRes.status).toBe(400);
      const invalidRegionBody = await invalidRegionRes.json();
      expect(invalidRegionBody.name).toBe("ValidationError");

      const invalidSeasonRes = await fetch(
        `${webserver.origin}/api/v1/solare/ranking?region=SA&season=0`,
      );
      expect(invalidSeasonRes.status).toBe(400);

      const invalidClassRes = await fetch(
        `${webserver.origin}/api/v1/solare/ranking?region=SA&class_type=999`,
      );
      expect(invalidClassRes.status).toBe(400);
    });

    test("With ranked players, class_type filter, and IP region inference", async () => {
      await orchestrator.createSolarePlayer({
        region: "SA",
        season: 9,
        user_no: 1002,
        user_nickname: "Shamsir",
        current_ranking: 23,
        class_type: 20,
        skill_branch_type: 2,
        win_count: 82,
        lose_count: 50,
        draw_count: 0,
      });

      await orchestrator.createSolarePlayer({
        region: "SA",
        season: 9,
        user_no: 1001,
        user_nickname: "Okazaki",
        current_ranking: 2,
        class_type: 20,
        skill_branch_type: 2,
        win_count: 109,
        lose_count: 67,
        draw_count: 0,
      });

      await orchestrator.createSolarePlayer({
        region: "SA",
        season: 9,
        user_no: 1003,
        user_nickname: "Neri",
        current_ranking: 22,
        class_type: 8,
        skill_branch_type: 2,
        win_count: 59,
        lose_count: 28,
        draw_count: 0,
      });

      await orchestrator.createSolarePlayer({
        region: "SA",
        season: 9,
        user_no: 1004,
        user_nickname: "StaleRank90",
        current_ranking: 90,
        class_type: 1,
        skill_branch_type: 1,
        win_count: 101,
        lose_count: 88,
        draw_count: 0,
      });

      await orchestrator.createSolarePlayer({
        region: "SA",
        season: 9,
        user_no: 1005,
        user_nickname: "ActiveRank90",
        current_ranking: 90,
        class_type: 20,
        skill_branch_type: 2,
        win_count: 81,
        lose_count: 65,
        draw_count: 0,
      });

      await orchestrator.createSolarePlayer({
        region: "NA",
        season: 9,
        user_no: 2001,
        user_nickname: "AmericanHero",
        current_ranking: 1,
        class_type: 0,
        skill_branch_type: 1,
        win_count: 90,
        lose_count: 30,
        draw_count: 0,
      });

      const matchOutcomes = [true, false, true, true, false, true];
      for (let i = 0; i < matchOutcomes.length; i += 1) {
        await orchestrator.createSolareMatch({
          region: "SA",
          season: 9,
          record_no: 950000 + i,
          user_nickname: "Okazaki",
          user_no: 1001,
          class_type: 20,
          skill_branch_type: 2,
          is_winner: matchOutcomes[i],
        });
      }

      // 1. SA Leaderboard ordered by current_ranking ASC (deduplicating stale rank #90)
      const saRes = await fetch(
        `${webserver.origin}/api/v1/solare/ranking?region=sa`,
      );
      expect(saRes.status).toBe(200);
      const saBody = await saRes.json();

      expect(saBody.region).toBe("SA");
      expect(saBody.season).toBe(9);
      expect(saBody.players.map((p) => p.user_nickname)).toEqual([
        "Okazaki",
        "Neri",
        "Shamsir",
        "ActiveRank90",
      ]);
      expect(saBody.players[0]).toMatchObject({
        rank: 2,
        class_ranking: 1,
        user_nickname: "Okazaki",
        class_type: 20,
        skill_branch_type: 2,
        wins: 109,
        losses: 67,
        total_games: 176,
        winrate: 61.9,
        recent_matches: [true, false, true, true, false],
      });
      expect(saBody.players[1].recent_matches).toEqual([]);
      expect(saBody.players.map((p) => p.class_ranking)).toEqual([1, 1, 2, 3]);

      // 2. Filter by class_type=8 (Sorceress)
      const sorcRes = await fetch(
        `${webserver.origin}/api/v1/solare/ranking?region=SA&class_type=8`,
      );
      expect(sorcRes.status).toBe(200);
      const sorcBody = await sorcRes.json();
      expect(sorcBody.players).toHaveLength(1);
      expect(sorcBody.players[0].user_nickname).toBe("Neri");

      // 3. IP region inference when region is omitted
      const naGeoRes = await fetch(
        `${webserver.origin}/api/v1/solare/ranking`,
        {
          headers: {
            "x-vercel-ip-country": "US",
          },
        },
      );
      expect(naGeoRes.status).toBe(200);
      const naGeoBody = await naGeoRes.json();
      expect(naGeoBody.region).toBe("NA");
      expect(naGeoBody.players).toHaveLength(1);
      expect(naGeoBody.players[0].user_nickname).toBe("AmericanHero");
    });
  });
});
