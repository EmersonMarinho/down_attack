import orchestrator from "tests/orchestrator.js";
import webserver from "~~/infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

describe("GET /api/v1/solare/chat", () => {
  describe("Anonymous User", () => {
    test("With missing nick and token", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/solare/chat`);

      expect(response.status).toBe(400);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "ValidationError",
        message: '"nick" or "token" is required.',
        action:
          "Please provide a Family Name or a valid overlay session token.",
        status_code: 400,
      });
    });

    test("With invalid region", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/chat?nick=Shxtey&region=INVALID_REGION`,
      );

      expect(response.status).toBe(400);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "ValidationError",
        message: "Invalid region: 'INVALID_REGION'.",
        action: "Valid regions are: SA, NA, EU, KR, JP, RU, TR, TW.",
        status_code: 400,
      });
    });

    test("With invalid token format", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/chat?token=${"a".repeat(65)}`,
      );

      expect(response.status).toBe(400);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "ValidationError",
        message: "Invalid session token.",
        action: "Please provide a valid session token.",
        status_code: 400,
      });
    });

    test("With nonexistent token", async () => {
      const nonexistentToken =
        "000000000000000000000000000000000000000000000000";

      const response = await fetch(
        `${webserver.origin}/api/v1/solare/chat?token=${nonexistentToken}`,
      );

      expect(response.status).toBe(404);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "NotFoundError",
        message: "Overlay session not found.",
        action: "Verify if the session token is valid or start a new session.",
        status_code: 404,
      });
    });

    test("With nonexistent player in database", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/chat?nick=GhostPlayer999&region=SA`,
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

    test("With valid session token and public nick lookup", async () => {
      // 1. Seed player and initial match 920906 (-27)
      await orchestrator.createSolarePlayer({
        region: "SA",
        user_no: 49934,
        user_nickname: "Shxtey",
        current_ranking: 1,
        class_type: 12,
        skill_branch_type: 2,
        win_count: 89,
        lose_count: 61,
        draw_count: 0,
        win_average: "59.34%",
      });

      await orchestrator.createSolarePlayer({
        region: "SA",
        user_no: 33878,
        user_nickname: "Dislaik",
        current_ranking: 322,
        class_type: 4,
        skill_branch_type: 1,
        win_count: 69,
        lose_count: 55,
        draw_count: 0,
        win_average: "55.65%",
      });

      await orchestrator.createSolareMatch({
        record_no: 920906,
        user_nickname: "Shxtey",
        is_winner: false,
        vary_rank_rating: -27,
      });

      // 2. Start overlay session anchored at match 920906 with rating 1945
      const sessionResponse = await fetch(
        `${webserver.origin}/api/v1/solare/session`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nick: "Shxtey",
            region: "SA",
            rating: 1945,
          }),
        },
      );

      expect(sessionResponse.status).toBe(201);
      const createdSession = await sessionResponse.json();

      // 3. Play 2 new matches during the active stream session:
      // Match 920907: Win (+28)
      await orchestrator.createSolareMatch({
        record_no: 920907,
        user_nickname: "Shxtey",
        is_winner: true,
        vary_rank_rating: 28,
      });

      // Match 920908: Loss (-15) -> 1W 1L (+13 PTS), Rating 1958 (Twilight Spear [III])
      await orchestrator.createSolareMatch({
        record_no: 920908,
        user_nickname: "Shxtey",
        is_winner: false,
        vary_rank_rating: -15,
      });

      // 4. Fetch chat summary using session token (Style 3: clean plain-text)
      const chatWithTokenResponse = await fetch(
        `${webserver.origin}/api/v1/solare/chat?token=${createdSession.token}`,
      );

      expect(chatWithTokenResponse.status).toBe(200);
      expect(chatWithTokenResponse.headers.get("content-type")).toContain(
        "text/plain",
      );
      expect(chatWithTokenResponse.headers.get("cache-control")).toBe(
        "public, max-age=0, s-maxage=10, stale-while-revalidate=10",
      );

      const chatWithTokenText = await chatWithTokenResponse.text();

      expect(chatWithTokenText).toBe(
        "[SA] Shxtey (Berserker Succession) — Rank #1 | Twilight Spear [III] (1958 PTS) | Live: 1W 1L (+13 PTS) | Season: 89W 61L (59.3% WR)",
      );

      // 5. Fetch chat summary by nick & region WITHOUT token
      const chatByNickResponse = await fetch(
        `${webserver.origin}/api/v1/solare/chat?nick=shxtey&region=sa`,
      );

      expect(chatByNickResponse.status).toBe(200);
      expect(chatByNickResponse.headers.get("content-type")).toContain(
        "text/plain",
      );

      const chatByNickText = await chatByNickResponse.text();

      expect(chatByNickText).toBe(
        "[SA] Shxtey (Berserker Succession) — Rank #1 | Season: 89W 61L (59.3% WR)",
      );

      // 6. Fetch chat summary for Dislaik (#322)
      const dislaikResponse = await fetch(
        `${webserver.origin}/api/v1/solare/chat?nick=Dislaik&region=SA`,
      );

      expect(dislaikResponse.status).toBe(200);

      const dislaikText = await dislaikResponse.text();

      expect(dislaikText).toBe(
        "[SA] Dislaik (Ranger Awakening) — Rank #322 | Season: 69W 55L (55.6% WR)",
      );
    });

    test("With negative session net PTS", async () => {
      await orchestrator.createSolarePlayer({
        region: "SA",
        user_no: 777001,
        user_nickname: "Okazaki",
        current_ranking: 65,
        class_type: 26,
        skill_branch_type: 1,
        win_count: 72,
        lose_count: 60,
        draw_count: 0,
        win_average: "54.55%",
      });

      await orchestrator.createSolareMatch({
        record_no: 930000,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: false,
        vary_rank_rating: -20,
      });

      const sessionResponse = await fetch(
        `${webserver.origin}/api/v1/solare/session`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            nick: "Okazaki",
            region: "SA",
            rating: 1500,
          }),
        },
      );

      expect(sessionResponse.status).toBe(201);
      const createdSession = await sessionResponse.json();

      // Match 930001: Loss (-22) -> 0W 1L (-22 PTS), Rating 1478 (Dawn Spear [I])
      await orchestrator.createSolareMatch({
        record_no: 930001,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: false,
        vary_rank_rating: -22,
      });

      const response = await fetch(
        `${webserver.origin}/api/v1/solare/chat?token=${createdSession.token}`,
      );

      expect(response.status).toBe(200);

      const responseText = await response.text();

      expect(responseText).toBe(
        "[SA] Okazaki (Ninja Awakening) — Rank #65 | Dawn Spear [I] (1478 PTS) | Live: 0W 1L (-22 PTS) | Season: 72W 60L (54.5% WR)",
      );
    });
  });
});
