import orchestrator from "tests/orchestrator.js";
import webserver from "~~/infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

describe("GET /api/v1/solare/player", () => {
  describe("Anonymous User", () => {
    test("With missing nick", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/solare/player`);

      expect(response.status).toBe(400);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "ValidationError",
        message:
          '"nick" is required and must be a string between 1 and 64 characters.',
        action: "Please provide a valid Family Name.",
        status_code: 400,
      });
    });

    test("With invalid region", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=Shamsir&region=INVALID`,
      );

      expect(response.status).toBe(400);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "ValidationError",
        message: "Invalid region: 'INVALID'.",
        action: "Valid regions are: SA, NA, EU, KR, JP, RU, TR, TW.",
        status_code: 400,
      });
    });

    test("With invalid season", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=Shamsir&season=0`,
      );

      expect(response.status).toBe(400);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "ValidationError",
        message: '"season" must be an integer between 1 and 100.',
        action: "Please provide a valid Solare season number.",
        status_code: 400,
      });
    });

    test("With invalid class_type", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=Shamsir&class_type=99`,
      );

      expect(response.status).toBe(400);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "ValidationError",
        message: '"class_type" must be an integer between 0 and 35.',
        action: "Please provide a valid class_type.",
        status_code: 400,
      });
    });

    test("With invalid page or limit", async () => {
      const badPageResponse = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=Shamsir&page=0`,
      );
      expect(badPageResponse.status).toBe(400);

      const badLimitResponse = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=Shamsir&limit=51`,
      );
      expect(badLimitResponse.status).toBe(400);
    });

    test("With nonexistent player in database", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=GhostPlayer999&region=SA`,
      );

      expect(response.status).toBe(404);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "NotFoundError",
        message: "Player 'GhostPlayer999' was not found in region 'SA'.",
        action: "Check if the Family Name and region are spelled correctly.",
        status_code: 404,
      });
    });

    test("With valid player, exact replay team order, win_record perspective normalization, class filter, season filter, and pagination", async () => {
      await orchestrator.createSolarePlayer({
        region: "SA",
        season: 9,
        user_no: 369181,
        user_nickname: "Shamsir",
        current_ranking: 23,
        class_type: 1,
        skill_branch_type: 2,
        win_count: 82,
        lose_count: 50,
        draw_count: 0,
        win_average: "62.13%",
      });

      // Match 1 (Season 8 historical match on Musa class_type 20)
      await orchestrator.createSolareMatch({
        region: "SA",
        season: 8,
        record_no: 888643,
        play_time_seconds: 297,
        win_record: [2, 2, 2],
        players: [
          {
            team: 0,
            user_nickname: "Shamsir",
            user_no: 369181,
            class_type: 20,
            skill_branch_type: 1,
            kill_count: 5,
            death_count: 0,
            cc_applied_count: 14,
            damage_done: 180000,
            damage_taken: 90000,
            recovery: 70000,
            is_winner: true,
            vary_rank_rating: 32,
          },
          {
            team: 0,
            user_nickname: "AllyA",
            user_no: 1001,
            class_type: 4,
            skill_branch_type: 1,
            kill_count: 2,
            death_count: 1,
            cc_applied_count: 8,
            damage_done: 120000,
            damage_taken: 100000,
            recovery: 50000,
            is_winner: true,
            vary_rank_rating: 25,
          },
          {
            team: 0,
            user_nickname: "AllyB",
            user_no: 1002,
            class_type: 15,
            skill_branch_type: 2,
            kill_count: 2,
            death_count: 1,
            cc_applied_count: 9,
            damage_done: 110000,
            damage_taken: 95000,
            recovery: 60000,
            is_winner: true,
            vary_rank_rating: 25,
          },
          {
            team: 1,
            user_nickname: "EnemyA",
            user_no: 2001,
            class_type: 27,
            skill_branch_type: 2,
            kill_count: 1,
            death_count: 3,
            cc_applied_count: 6,
            damage_done: 95000,
            damage_taken: 140000,
            recovery: 45000,
            is_winner: false,
            vary_rank_rating: -23,
          },
          {
            team: 1,
            user_nickname: "EnemyB",
            user_no: 2002,
            class_type: 26,
            skill_branch_type: 1,
            kill_count: 1,
            death_count: 3,
            cc_applied_count: 5,
            damage_done: 88000,
            damage_taken: 135000,
            recovery: 40000,
            is_winner: false,
            vary_rank_rating: -23,
          },
          {
            team: 1,
            user_nickname: "EnemyC",
            user_no: 2003,
            class_type: 2,
            skill_branch_type: 1,
            kill_count: 0,
            death_count: 3,
            cc_applied_count: 4,
            damage_done: 72000,
            damage_taken: 135000,
            recovery: 35000,
            is_winner: false,
            vary_rank_rating: -23,
          },
        ],
      });

      // Match 2 (Season 9 match #943351 on Musa Awakening class_type 20)
      await orchestrator.createSolareMatch({
        region: "SA",
        season: 9,
        record_no: 943351,
        play_time_seconds: 310,
        win_record: [3, 3, 2, 3],
        players: [
          {
            team: 0,
            user_nickname: "Shamsir",
            user_no: 369181,
            class_type: 20,
            skill_branch_type: 1,
            kill_count: 2,
            death_count: 3,
            cc_applied_count: 11,
            damage_done: 140534,
            damage_taken: 161859,
            recovery: 90438,
            is_winner: false,
            vary_rank_rating: -21,
          },
          {
            team: 0,
            user_nickname: "PEKOPEKOPEKO",
            user_no: 94522,
            class_type: 4,
            skill_branch_type: 1,
            kill_count: 1,
            death_count: 3,
            cc_applied_count: 8,
            damage_done: 110000,
            damage_taken: 150000,
            recovery: 80000,
            is_winner: false,
            vary_rank_rating: -22,
          },
          {
            team: 0,
            user_nickname: "Amiquechucha",
            user_no: 958927,
            class_type: 15,
            skill_branch_type: 2,
            kill_count: 1,
            death_count: 3,
            cc_applied_count: 6,
            damage_done: 105000,
            damage_taken: 155000,
            recovery: 85000,
            is_winner: false,
            vary_rank_rating: -20,
          },
          {
            team: 1,
            user_nickname: "Neri",
            user_no: 12658,
            class_type: 27,
            skill_branch_type: 2,
            kill_count: 3,
            death_count: 1,
            cc_applied_count: 12,
            damage_done: 175000,
            damage_taken: 120000,
            recovery: 95000,
            is_winner: true,
            vary_rank_rating: 26,
          },
          {
            team: 1,
            user_nickname: "SamurayGB",
            user_no: 143123,
            class_type: 26,
            skill_branch_type: 1,
            kill_count: 3,
            death_count: 2,
            cc_applied_count: 10,
            damage_done: 160000,
            damage_taken: 130000,
            recovery: 92000,
            is_winner: true,
            vary_rank_rating: 25,
          },
          {
            team: 1,
            user_nickname: "RichFamily",
            user_no: 1050186,
            class_type: 2,
            skill_branch_type: 1,
            kill_count: 3,
            death_count: 1,
            cc_applied_count: 9,
            damage_done: 150000,
            damage_taken: 115000,
            recovery: 88000,
            is_winner: true,
            vary_rank_rating: 25,
          },
        ],
      });

      // Match 3 (Season 9 latest match #945709 on Hashashin Succession class_type 1)
      // Replay order: PEKOPEKOPEKO, Shamsir, Amiquechucha vs Neri, SamurayGB, RichFamily
      await orchestrator.createSolareMatch({
        region: "SA",
        season: 9,
        record_no: 945709,
        play_time_seconds: 507,
        win_record: [2, 2, 3, 2],
        players: [
          {
            team: 0,
            user_nickname: "PEKOPEKOPEKO",
            user_no: 94522,
            class_type: 4,
            skill_branch_type: 1,
            kill_count: 3,
            death_count: 1,
            cc_applied_count: 10,
            damage_done: 104779,
            damage_taken: 131861,
            recovery: 107611,
            is_winner: true,
            vary_rank_rating: 25,
          },
          {
            team: 0,
            user_nickname: "Shamsir",
            user_no: 369181,
            class_type: 1,
            skill_branch_type: 2,
            kill_count: 4,
            death_count: 1,
            cc_applied_count: 19,
            damage_done: 219466,
            damage_taken: 138141,
            recovery: 109562,
            is_winner: true,
            vary_rank_rating: 27,
          },
          {
            team: 0,
            user_nickname: "Amiquechucha",
            user_no: 958927,
            class_type: 15,
            skill_branch_type: 2,
            kill_count: 2,
            death_count: 2,
            cc_applied_count: 7,
            damage_done: 159188,
            damage_taken: 145785,
            recovery: 112652,
            is_winner: true,
            vary_rank_rating: 29,
          },
          {
            team: 1,
            user_nickname: "Neri",
            user_no: 12658,
            class_type: 27,
            skill_branch_type: 2,
            kill_count: 2,
            death_count: 3,
            cc_applied_count: 10,
            damage_done: 191091,
            damage_taken: 158659,
            recovery: 112413,
            is_winner: false,
            vary_rank_rating: -25,
          },
          {
            team: 1,
            user_nickname: "SamurayGB",
            user_no: 143123,
            class_type: 26,
            skill_branch_type: 1,
            kill_count: 1,
            death_count: 3,
            cc_applied_count: 12,
            damage_done: 95563,
            damage_taken: 189332,
            recovery: 130149,
            is_winner: false,
            vary_rank_rating: -25,
          },
          {
            team: 1,
            user_nickname: "RichFamily",
            user_no: 1050186,
            class_type: 2,
            skill_branch_type: 1,
            kill_count: 1,
            death_count: 3,
            cc_applied_count: 3,
            damage_done: 129133,
            damage_taken: 135442,
            recovery: 89639,
            is_winner: false,
            vary_rank_rating: -25,
          },
        ],
      });

      // 1. Default query for Shamsir (Season 9, all classes)
      const shamsirRes = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=shamsir&region=sa`,
      );
      expect(shamsirRes.status).toBe(200);
      expect(shamsirRes.headers.get("cache-control")).toBe(
        "public, max-age=0, s-maxage=10, stale-while-revalidate=10",
      );
      expect(shamsirRes.headers.get("vary")).toBeNull();
      const shamsirBody = await shamsirRes.json();

      expect(shamsirBody.region).toBe("SA");
      expect(shamsirBody.season).toBe(9);
      expect(shamsirBody.user_nickname).toBe("Shamsir");
      expect(shamsirBody.user_no).toBe("369181");
      expect(shamsirBody.current_ranking).toBe(23);
      expect(shamsirBody.class_ranking).toBe(1);
      expect(shamsirBody.overall).toEqual({
        wins: 82,
        losses: 50,
        draws: 0,
        total_games: 132,
        winrate: 62.1,
        best_win_streak: 1,
        current_win_streak: 1,
      });
      expect(shamsirBody.recent_pdl_deltas).toEqual([-21, 27]);
      expect(shamsirBody.averages).toEqual({
        kills: 3,
        deaths: 2,
        cc: 15,
        damage_done: 180000,
        damage_taken: 150000,
        recovery: 100000,
      });
      expect(shamsirBody.classes).toHaveLength(2);
      expect(shamsirBody.pagination).toEqual({
        page: 1,
        limit: 20,
        total_matches: 2,
        total_pages: 1,
        has_more: false,
      });

      // Verify newest match (#945709) is first and preserves exact replay order
      const latestMatch = shamsirBody.matches[0];
      expect(latestMatch.record_no).toBe(945709);
      expect(latestMatch.is_winner).toBe(true);
      expect(latestMatch.vary_rank_rating).toBe(27);
      expect(latestMatch.win_record).toEqual([2, 2, 3, 2]);
      expect(latestMatch.allies.map((p) => p.user_nickname)).toEqual([
        "PEKOPEKOPEKO",
        "Shamsir",
        "Amiquechucha",
      ]);
      expect(latestMatch.enemies.map((p) => p.user_nickname)).toEqual([
        "Neri",
        "SamurayGB",
        "RichFamily",
      ]);

      // 2. Query from Enemy Perspective (Neri on team 1 in match #945709)
      const neriRes = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=Neri&region=SA&season=9`,
      );
      expect(neriRes.status).toBe(200);
      const neriBody = await neriRes.json();

      const neriMatch945709 = neriBody.matches[0];
      expect(neriMatch945709.record_no).toBe(945709);
      expect(neriMatch945709.is_winner).toBe(false);
      expect(neriMatch945709.vary_rank_rating).toBe(-25);
      // Inverted win_record for team 1 perspective: [2, 2, 3, 2] -> [3, 3, 2, 3]
      expect(neriMatch945709.win_record).toEqual([3, 3, 2, 3]);
      expect(neriMatch945709.allies.map((p) => p.user_nickname)).toEqual([
        "Neri",
        "SamurayGB",
        "RichFamily",
      ]);
      expect(neriMatch945709.enemies.map((p) => p.user_nickname)).toEqual([
        "PEKOPEKOPEKO",
        "Shamsir",
        "Amiquechucha",
      ]);

      // 3. Filter by class_type (class_type=20 Musa)
      const classFilterRes = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=Shamsir&region=SA&season=9&class_type=20`,
      );
      expect(classFilterRes.status).toBe(200);
      const classFilterBody = await classFilterRes.json();
      expect(classFilterBody.pagination.total_matches).toBe(1);
      expect(classFilterBody.matches[0].record_no).toBe(943351);
      // All classes played in the season are still returned in the summary
      expect(classFilterBody.classes).toHaveLength(2);

      // 4. Filter by Season 8
      const season8Res = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=Shamsir&region=SA&season=8`,
      );
      expect(season8Res.status).toBe(200);
      const season8Body = await season8Res.json();
      expect(season8Body.season).toBe(8);
      expect(season8Body.pagination.total_matches).toBe(1);
      expect(season8Body.matches[0].record_no).toBe(888643);

      // 5. Pagination (page=1&limit=1 vs page=2&limit=1)
      const page1Res = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=Shamsir&region=SA&season=9&page=1&limit=1`,
      );
      const page1Body = await page1Res.json();
      expect(page1Body.pagination).toEqual({
        page: 1,
        limit: 1,
        total_matches: 2,
        total_pages: 2,
        has_more: true,
      });
      expect(page1Body.matches[0].record_no).toBe(945709);

      const page2Res = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=Shamsir&region=SA&season=9&page=2&limit=1`,
      );
      const page2Body = await page2Res.json();
      expect(page2Body.pagination).toEqual({
        page: 2,
        limit: 1,
        total_matches: 2,
        total_pages: 2,
        has_more: false,
      });
      expect(page2Body.matches[0].record_no).toBe(943351);
    });

    test("Infers region from IP geolocation headers when region is omitted", async () => {
      await orchestrator.createSolarePlayer({
        region: "NA",
        season: 9,
        user_no: 888001,
        user_nickname: "NaPlayerOne",
        current_ranking: 10,
        class_type: 8,
        skill_branch_type: 1,
        win_count: 50,
        lose_count: 30,
        draw_count: 0,
        win_average: "62.5%",
      });

      const naResponse = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=NaPlayerOne`,
        {
          headers: {
            "x-vercel-ip-country": "US",
          },
        },
      );

      expect(naResponse.status).toBe(200);
      expect(naResponse.headers.get("vary")).toBe(
        "x-vercel-ip-country, cf-ipcountry, x-country-code",
      );
      const naBody = await naResponse.json();
      expect(naBody.region).toBe("NA");
      expect(naBody.user_nickname).toBe("NaPlayerOne");
    });
  });
});
