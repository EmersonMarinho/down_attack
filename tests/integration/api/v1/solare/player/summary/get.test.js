import orchestrator from "tests/orchestrator.js";
import database from "~~/infra/database.js";
import webserver from "~~/infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

describe("GET /api/v1/solare/player/summary", () => {
  describe("Anonymous User", () => {
    test("With missing nick", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/player/summary`,
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({
        name: "ValidationError",
        message:
          '"nick" is required and must be a string between 1 and 64 characters.',
        action: "Please provide a valid Family Name.",
        status_code: 400,
      });
    });

    test("With invalid region or season", async () => {
      const badRegionRes = await fetch(
        `${webserver.origin}/api/v1/solare/player/summary?nick=Okazaki&region=INVALID`,
      );
      expect(badRegionRes.status).toBe(400);

      const badSeasonRes = await fetch(
        `${webserver.origin}/api/v1/solare/player/summary?nick=Okazaki&region=SA&season=101`,
      );
      expect(badSeasonRes.status).toBe(400);
    });

    test("With nonexistent player in database", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/player/summary?nick=MissingSummaryPlayer&region=SA`,
      );

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toEqual({
        name: "NotFoundError",
        message: "Player 'MissingSummaryPlayer' was not found in region 'SA'.",
        action: "Check if the Family Name and region are spelled correctly.",
        status_code: 404,
      });
    });

    test("Returns lightweight ranked summary with class_ranking, kd_ratio, classes, and excludes practice matches", async () => {
      await orchestrator.createSolarePlayer({
        region: "SA",
        season: 9,
        user_no: 700101,
        user_nickname: "TopMusaOne",
        current_ranking: 2,
        rank_rating: 2510,
        class_type: 20,
        skill_branch_type: 1,
        win_count: 90,
        lose_count: 45,
        draw_count: 0,
      });

      await orchestrator.createSolarePlayer({
        region: "SA",
        season: 9,
        user_no: 700102,
        user_nickname: "OkazakiSummary",
        current_ranking: 12,
        rank_rating: 2450,
        class_type: 20,
        skill_branch_type: 1,
        win_count: 78,
        lose_count: 48,
        draw_count: 0,
      });

      // Ranked Match 1 on Musa Awakening (20, 1): 4K / 1D
      await orchestrator.createSolareMatch({
        region: "SA",
        season: 9,
        record_no: 980001,
        user_nickname: "OkazakiSummary",
        user_no: 700102,
        class_type: 20,
        skill_branch_type: 1,
        is_winner: true,
        players: [
          {
            team: 0,
            user_nickname: "OkazakiSummary",
            user_no: 700102,
            class_type: 20,
            skill_branch_type: 1,
            kill_count: 4,
            death_count: 1,
            cc_applied_count: 14,
            damage_done: 210000,
            damage_taken: 110000,
            recovery: 80000,
            is_winner: true,
            vary_rank_rating: 26,
          },
        ],
      });

      // Ranked Match 2 on Musa Awakening (20, 1): 2K / 2D
      await orchestrator.createSolareMatch({
        region: "SA",
        season: 9,
        record_no: 980002,
        user_nickname: "OkazakiSummary",
        user_no: 700102,
        class_type: 20,
        skill_branch_type: 1,
        is_winner: true,
        players: [
          {
            team: 0,
            user_nickname: "OkazakiSummary",
            user_no: 700102,
            class_type: 20,
            skill_branch_type: 1,
            kill_count: 2,
            death_count: 2,
            cc_applied_count: 10,
            damage_done: 150000,
            damage_taken: 130000,
            recovery: 90000,
            is_winner: true,
            vary_rank_rating: 24,
          },
        ],
      });

      // Ranked Match 3 on Ninja Succession (26, 2): 3K / 1D
      await orchestrator.createSolareMatch({
        region: "SA",
        season: 9,
        record_no: 980003,
        user_nickname: "OkazakiSummary",
        user_no: 700102,
        class_type: 26,
        skill_branch_type: 2,
        is_winner: false,
        players: [
          {
            team: 0,
            user_nickname: "OkazakiSummary",
            user_no: 700102,
            class_type: 26,
            skill_branch_type: 2,
            kill_count: 3,
            death_count: 1,
            cc_applied_count: 12,
            damage_done: 180000,
            damage_taken: 150000,
            recovery: 70000,
            is_winner: false,
            vary_rank_rating: -22,
          },
        ],
      });

      // Practice Match 4 on Berserker (12, 2): must be excluded from summary classes & K/D!
      await orchestrator.createSolareMatch({
        region: "SA",
        season: 9,
        record_no: 980004,
        user_nickname: "OkazakiSummary",
        user_no: 700102,
        class_type: 12,
        skill_branch_type: 2,
        is_winner: false,
        players: [
          {
            team: 0,
            user_nickname: "OkazakiSummary",
            user_no: 700102,
            class_type: 12,
            skill_branch_type: 2,
            kill_count: 0,
            death_count: 10,
            cc_applied_count: 0,
            damage_done: 10000,
            damage_taken: 300000,
            recovery: 0,
            is_winner: false,
            vary_rank_rating: 0,
          },
        ],
      });
      await database.query({
        text: `
          INSERT INTO solare_match_mode_proofs (region, record_no, mode, method)
          VALUES ('SA', 980004, 'practice', 'manual_test_proof')
          ON CONFLICT (region, record_no) DO UPDATE SET mode = 'practice';
        `,
      });

      const response = await fetch(
        `${webserver.origin}/api/v1/solare/player/summary?nick=okazakisummary&region=sa`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
      );
      expect(response.headers.get("vary")).toBeNull();

      const body = await response.json();
      expect(body.region).toBe("SA");
      expect(body.season).toBe(9);
      expect(body.user_nickname).toBe("OkazakiSummary");
      expect(body.user_no).toBe("700102");
      expect(body.current_ranking).toBe(2);
      expect(body.official_ranking).toBe(12);
      expect(body.class_ranking).toBe(2);
      // 2450 initial + 26 + 24 - 22 (ranked triggers) + 0 (practice) = 2478
      expect(body.rank_rating).toBe(2478);
      expect(body.class_type).toBe(20);
      expect(body.skill_branch_type).toBe(1);
      // Total non-practice kills = 4 + 2 + 3 = 9; deaths = 1 + 2 + 1 = 4 -> 9/4 = 2.25
      expect(body.kd_ratio).toBe(2.25);
      expect(body.overall).toEqual({
        wins: 78,
        losses: 48,
        draws: 0,
        total_games: 126,
        winrate: 61.9,
      });
      expect(body.classes).toHaveLength(2);
      expect(body.classes[0]).toMatchObject({
        class_type: 20,
        skill_branch_type: 1,
        wins: 2,
        losses: 0,
        total_games: 2,
        winrate: 100,
      });
      expect(body.classes[1]).toMatchObject({
        class_type: 26,
        skill_branch_type: 2,
        wins: 0,
        losses: 1,
        total_games: 1,
        winrate: 0,
      });
      expect(body.matches).toBeUndefined();
      expect(body.pagination).toBeUndefined();
    });

    test("Infers region from IP geolocation headers when region is omitted", async () => {
      await orchestrator.createSolarePlayer({
        region: "EU",
        season: 9,
        user_no: 700201,
        user_nickname: "EuSummaryHero",
        current_ranking: 5,
        rank_rating: 2380,
        class_type: 8,
        skill_branch_type: 1,
        win_count: 60,
        lose_count: 30,
        draw_count: 0,
      });

      const response = await fetch(
        `${webserver.origin}/api/v1/solare/player/summary?nick=EuSummaryHero`,
        {
          headers: {
            "x-vercel-ip-country": "DE",
          },
        },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("vary")).toBe(
        "x-vercel-ip-country, cf-ipcountry, x-country-code",
      );
      const body = await response.json();
      expect(body.region).toBe("EU");
      expect(body.user_nickname).toBe("EuSummaryHero");
      expect(body.kd_ratio).toBeNull();
    });
  });
});
