import orchestrator from "tests/orchestrator.js";
import webserver from "~~/infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

describe("GET /api/v1/solare/overlay", () => {
  describe("Anonymous User", () => {
    test("With missing nick and token", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/solare/overlay`);

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
        `${webserver.origin}/api/v1/solare/overlay?nick=Shxtey&region=INVALID_REGION`,
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
        `${webserver.origin}/api/v1/solare/overlay?token=${"a".repeat(65)}`,
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
        `${webserver.origin}/api/v1/solare/overlay?token=${nonexistentToken}`,
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
        `${webserver.origin}/api/v1/solare/overlay?nick=GhostPlayer999&region=SA`,
      );

      expect(response.status).toBe(404);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "NotFoundError",
        message: "Player 'GhostPlayer999' was not found in region 'SA'.",
        action: "Check if the Family Name and region are spelled correctly.",
        status_code: 404,
      });

      const responseWithSince = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?nick=GhostPlayer999&region=SA&since=920908`,
      );
      expect(responseWithSince.status).toBe(404);
    });

    test("With invalid since parameter", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?nick=Shxtey&region=SA&since=invalid`,
      );

      expect(response.status).toBe(400);

      const responseBody = await response.json();

      expect(responseBody).toEqual({
        name: "ValidationError",
        message: '"since" must be a non-negative integer.',
        action: "Please provide a valid match record_no for since.",
        status_code: 400,
      });
    });

    test("With valid nick, session token, and player outside Top 100", async () => {
      // 1. Seed Top 100 player and initial match 920906 (-27)
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

      await orchestrator.createSolareMatch({
        record_no: 920906,
        user_nickname: "Shxtey",
        is_winner: false,
        vary_rank_rating: -27,
        kill_count: 0,
        death_count: 3,
        cc_applied_count: 6,
        damage_done: 40000,
        damage_taken: 90000,
        recovery: 50000,
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
        kill_count: 6,
        death_count: 0,
        cc_applied_count: 12,
        damage_done: 110000,
        damage_taken: 45000,
        recovery: 40000,
      });

      // Match 920908: Loss (-15)
      await orchestrator.createSolareMatch({
        record_no: 920908,
        user_nickname: "Shxtey",
        is_winner: false,
        vary_rank_rating: -15,
        kill_count: 3,
        death_count: 3,
        cc_applied_count: 9,
        damage_done: 90000,
        damage_taken: 75000,
        recovery: 30000,
      });

      // 4. Fetch overlay using session token
      const overlayWithTokenResponse = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}`,
      );

      expect(overlayWithTokenResponse.status).toBe(200);
      expect(overlayWithTokenResponse.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );

      const overlayWithTokenBody = await overlayWithTokenResponse.json();

      expect(overlayWithTokenBody).toEqual({
        region: "SA",
        user_nickname: "Shxtey",
        user_no: "49934",
        current_ranking: 1,
        class_type: 12,
        skill_branch_type: 2,
        rating: 1958,
        latest_record_no: 920908,
        latest_match: {
          record_no: 920908,
          is_winner: false,
          kills: 3,
          deaths: 3,
          cc: 9,
          damage_done: 90000,
          damage_taken: 75000,
          recovery: 30000,
          match_date: expect.any(String),
        },
        overall: {
          wins: 89,
          losses: 61,
          draws: 0,
          total_games: 150,
          winrate: 59.3,
        },
        averages: {
          kills: 3,
          deaths: 2,
          cc: 9,
          damage_done: 80000,
          damage_taken: 70000,
          recovery: 40000,
        },
        session: {
          anchor_rating: 1945,
          anchor_record_no: 920906,
          session_start_record_no: 920906,
          wins: 1,
          losses: 1,
          draws: 0,
          total_games: 2,
          winrate: 50,
          net_pdl: 13,
          recent_deltas: [-15, 28],
        },
      });

      // 5. Fetch overlay by nick & region WITHOUT token (e.g., preview / configurator lookup)
      const overlayByNickResponse = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?nick=shxtey&region=sa`,
      );

      expect(overlayByNickResponse.status).toBe(200);

      const overlayByNickBody = await overlayByNickResponse.json();

      expect(overlayByNickBody.user_nickname).toBe("Shxtey");
      expect(overlayByNickBody.current_ranking).toBe(1);
      expect(overlayByNickBody.rating).toBeNull();
      expect(overlayByNickBody.latest_record_no).toBe(920908);
      expect(overlayByNickBody.session).toBeNull();

      // 6. Fetch overlay for a player OUTSIDE Top 100 (Dislaik only exists in solare_match_players)
      const outsideTop100Response = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?nick=Dislaik&region=SA`,
      );

      expect(outsideTop100Response.status).toBe(200);

      const outsideTop100Body = await outsideTop100Response.json();

      expect(outsideTop100Body.user_nickname).toBe("Dislaik");
      expect(outsideTop100Body.current_ranking).toBeNull();
      expect(outsideTop100Body.class_type).toBe(4);
      expect(outsideTop100Body.skill_branch_type).toBe(1);
      expect(outsideTop100Body.overall).toEqual({
        wins: 1,
        losses: 2,
        draws: 0,
        total_games: 3,
        winrate: 33.3,
      });
    });

    test("With consecutive wins applying official Win Streak Bonus (+2, +5, +8) and reset on loss", async () => {
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

      // Match before session start (Loss -20, resets any prior streak)
      await orchestrator.createSolareMatch({
        record_no: 930000,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: false,
        vary_rank_rating: -20,
      });

      // Start session anchored at 930000 with 1500 PDL
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

      // Win 1: +23
      await orchestrator.createSolareMatch({
        record_no: 930001,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: true,
        vary_rank_rating: 23,
      });

      // Win 2 (streak 2, vary_rank_rating from PA already includes +2 bonus): +22
      await orchestrator.createSolareMatch({
        record_no: 930002,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: true,
        vary_rank_rating: 22,
      });

      // Win 3 (streak 3, vary_rank_rating from PA already includes +2 bonus): +25
      await orchestrator.createSolareMatch({
        record_no: 930003,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: true,
        vary_rank_rating: 25,
      });

      // Win 4 (streak 4, vary_rank_rating from PA already includes +5 bonus): +34
      await orchestrator.createSolareMatch({
        record_no: 930004,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: true,
        vary_rank_rating: 34,
      });

      const streak4Response = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}`,
      );
      expect(streak4Response.status).toBe(200);
      const streak4Body = await streak4Response.json();

      // 23 + 22 + 25 + 34 = 104 net PDL -> 1604 rating
      expect(streak4Body.rating).toBe(1604);
      expect(streak4Body.session.net_pdl).toBe(104);
      expect(streak4Body.session.recent_deltas).toEqual([34, 25, 22, 23]);

      // Wins 5, 6, 7 (+30 each) and Win 8 (+33)
      for (const [recNo, vary] of [
        [930005, 30],
        [930006, 30],
        [930007, 30],
        [930008, 33],
      ]) {
        await orchestrator.createSolareMatch({
          record_no: recNo,
          user_nickname: "Okazaki",
          user_no: 777001,
          is_winner: true,
          vary_rank_rating: vary,
        });
      }

      // Loss on 930009 (-20) and Win on 930010 (+25)
      await orchestrator.createSolareMatch({
        record_no: 930009,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: false,
        vary_rank_rating: -20,
      });

      await orchestrator.createSolareMatch({
        record_no: 930010,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: true,
        vary_rank_rating: 25,
      });

      const fullStreakResponse = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}`,
      );
      expect(fullStreakResponse.status).toBe(200);
      const fullStreakBody = await fullStreakResponse.json();

      // Previous 104 + (30 + 30 + 30 + 33) - 20 + 25 = 232 net PDL -> 1732 rating
      expect(fullStreakBody.rating).toBe(1732);
      expect(fullStreakBody.session.net_pdl).toBe(232);
      expect(fullStreakBody.session.recent_deltas).toEqual([
        25, -20, 33, 30, 30,
      ]);
      const fullStreakEtag = fullStreakResponse.headers.get("etag");
      expect(fullStreakEtag).toBe(
        'W/"930010:11:11:212:72:60:0:n:65:26:1:930000:930000:1500"',
      );

      // Polling a session with matching since + session ETag (header) returns 304 Not Modified
      const notModifiedBySince = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930010`,
        { headers: { "If-None-Match": fullStreakEtag } },
      );
      expect(notModifiedBySince.status).toBe(304);
      expect(notModifiedBySince.headers.get("etag")).toBe(fullStreakEtag);
      expect(notModifiedBySince.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
      expect(await notModifiedBySince.text()).toBe("");

      // The session ETag mirrored in the `etag` query param (CDN strips If-None-Match) also returns 304
      const notModifiedByEtagParam = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930010&etag=${encodeURIComponent(fullStreakEtag)}`,
      );
      expect(notModifiedByEtagParam.status).toBe(304);
      expect(await notModifiedByEtagParam.text()).toBe("");

      // Legacy 4-part ETag from older overlay clients self-heals with 200 OK instead of freezing on 304
      const legacyFourPartEtagResponse = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930010`,
        { headers: { "If-None-Match": 'W/"930010:930000:930000:1500"' } },
      );
      expect(legacyFourPartEtagResponse.status).toBe(200);
      expect(legacyFourPartEtagResponse.headers.get("etag")).toBe(
        fullStreakEtag,
      );

      // A session poll without the session fingerprint can't prove freshness and returns 200 OK
      const sessionWithoutFingerprint = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930010`,
      );
      expect(sessionWithoutFingerprint.status).toBe(200);
      const sessionWithoutFingerprintBody =
        await sessionWithoutFingerprint.json();
      expect(sessionWithoutFingerprintBody.latest_record_no).toBe(930010);
      expect(sessionWithoutFingerprintBody.rating).toBe(1732);

      // Polling by nick+region with since_record_no returns 304 Not Modified
      const notModifiedByNick = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?nick=Okazaki&region=SA&since_record_no=930010`,
      );
      expect(notModifiedByNick.status).toBe(304);
      expect(notModifiedByNick.headers.get("etag")).toBe(
        'W/"930010:11:11:212:72:60:0:n:65:26:1"',
      );
      expect(await notModifiedByNick.text()).toBe("");

      // Polling with older since returns 200 OK with full payload
      const staleSinceResponse = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930009`,
      );
      expect(staleSinceResponse.status).toBe(200);
      const staleSinceBody = await staleSinceResponse.json();
      expect(staleSinceBody.latest_record_no).toBe(930010);

      // Resetting the session at the same latest_record_no (930010) invalidates the previous session ETag
      const resetSessionRes = await fetch(
        `${webserver.origin}/api/v1/solare/session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: createdSession.token,
            nick: "Okazaki",
            region: "SA",
            rating: 1750,
          }),
        },
      );
      expect(resetSessionRes.status).toBe(200);

      const afterResetWithOldEtag = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930010`,
        {
          headers: {
            "If-None-Match": fullStreakEtag,
          },
        },
      );
      expect(afterResetWithOldEtag.status).toBe(200);
      const afterResetBody = await afterResetWithOldEtag.json();
      expect(afterResetBody.rating).toBe(1750);
      expect(afterResetBody.session.anchor_rating).toBe(1750);
      expect(afterResetBody.session.total_games).toBe(0);

      const newSessionEtag = afterResetWithOldEtag.headers.get("etag");
      expect(newSessionEtag).toBe(
        'W/"930010:11:11:212:72:60:0:n:65:26:1:930010:930010:1750"',
      );

      // The old session fingerprint mirrored in the query param is also rejected after reset
      const afterResetOldEtagParam = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930010&etag=${encodeURIComponent(fullStreakEtag)}`,
      );
      expect(afterResetOldEtagParam.status).toBe(200);
      expect((await afterResetOldEtagParam.json()).rating).toBe(1750);

      // Subsequent poll with the updated session ETag returns 304 Not Modified
      const afterResetNotModified = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930010`,
        {
          headers: {
            "If-None-Match": newSessionEtag,
          },
        },
      );
      expect(afterResetNotModified.status).toBe(304);

      // --- Two-stage crawler ingestion regression test ---
      // Stage 1: Another participant in match 930011 is crawled first, inserting
      // Okazaki's participant row with is_winner=true and vary_rank_rating=null,
      // while solare_players still holds the previous W/L (72W 60L).
      await orchestrator.createSolareMatch({
        record_no: 930011,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: true,
        vary_rank_rating: null,
      });

      const stage1Poll = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930010&etag=${encodeURIComponent(newSessionEtag)}`,
        { headers: { "If-None-Match": newSessionEtag } },
      );
      expect(stage1Poll.status).toBe(200);
      const stage1Etag = stage1Poll.headers.get("etag");
      const stage1Body = await stage1Poll.json();

      // During Stage 1, TODAY RECORD must NOT prematurely jump to 1W-0L while
      // rating/net_pdl/overall are still awaiting Stage 2.
      expect(stage1Body.latest_record_no).toBe(930011);
      expect(stage1Body.rating).toBe(1750);
      expect(stage1Body.overall.wins).toBe(72);
      expect(stage1Body.overall.losses).toBe(60);
      expect(stage1Body.session.wins).toBe(0);
      expect(stage1Body.session.losses).toBe(0);
      expect(stage1Body.session.net_pdl).toBe(0);
      expect(stage1Body.session.recent_deltas).toEqual([]);

      // Bare nick+since poll without ETag also refuses 304 while latest match is half-crawled
      const stage1BareNickPoll = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?nick=Okazaki&region=SA&since=930011`,
      );
      expect(stage1BareNickPoll.status).toBe(200);

      // Stage 2: Seconds later, the crawler visits Okazaki directly, populating
      // vary_rank_rating=+21 on match 930011 and updating solare_players W/L & rating.
      await orchestrator.createSolareMatch({
        record_no: 930011,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: true,
        vary_rank_rating: 21,
      });
      await orchestrator.createSolarePlayer({
        region: "SA",
        user_no: 777001,
        user_nickname: "Okazaki",
        current_ranking: 65,
        class_type: 26,
        skill_branch_type: 1,
        win_count: 73,
        lose_count: 60,
        draw_count: 0,
        win_average: "54.89%",
        rank_rating: 1771,
      });

      // Polling at the SAME since=930011 with Stage 1's ETag MUST return 200 OK (NOT 304!)
      const stage2Poll = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930011&etag=${encodeURIComponent(stage1Etag)}`,
        { headers: { "If-None-Match": stage1Etag } },
      );
      expect(stage2Poll.status).toBe(200);
      const stage2Etag = stage2Poll.headers.get("etag");
      expect(stage2Etag).not.toBe(stage1Etag);
      const stage2Body = await stage2Poll.json();

      expect(stage2Body.latest_record_no).toBe(930011);
      expect(stage2Body.rating).toBe(1771);
      expect(stage2Body.overall).toEqual({
        wins: 73,
        losses: 60,
        draws: 0,
        total_games: 133,
        winrate: 54.9,
      });
      expect(stage2Body.session).toEqual({
        anchor_rating: 1750,
        anchor_record_no: 930010,
        session_start_record_no: 930010,
        wins: 1,
        losses: 0,
        draws: 0,
        total_games: 1,
        winrate: 100,
        net_pdl: 21,
        recent_deltas: [21],
      });

      // Once the client holds Stage 2's ETag, subsequent polls cleanly return 304 Not Modified
      const stage2SteadyPoll = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930011&etag=${encodeURIComponent(stage2Etag)}`,
        { headers: { "If-None-Match": stage2Etag } },
      );
      expect(stage2SteadyPoll.status).toBe(304);

      // --- Borderline Top-100 dropout (ranking_superseded) regression test ---
      // Match 930012 (loss, vary_rank_rating=null) arrives via another Top-100
      // participant while Okazaki (#65) has not yet been superseded.
      await orchestrator.createSolareMatch({
        record_no: 930012,
        user_nickname: "Okazaki",
        user_no: 777001,
        is_winner: false,
        vary_rank_rating: null,
      });

      const preSupersededPoll = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930011&etag=${encodeURIComponent(stage2Etag)}`,
        { headers: { "If-None-Match": stage2Etag } },
      );
      expect(preSupersededPoll.status).toBe(200);
      const preSupersededEtag = preSupersededPoll.headers.get("etag");
      const preSupersededBody = await preSupersededPoll.json();
      expect(preSupersededBody.session.wins).toBe(1);
      expect(preSupersededBody.session.losses).toBe(0);

      // Another player now claims #65 with a newer last_seen_at (Okazaki dropped
      // out of Top 100, so vary_rank_rating on 930012 will remain null).
      await orchestrator.createSolarePlayer({
        region: "SA",
        user_no: 777002,
        user_nickname: "NewRank65Holder",
        current_ranking: 65,
        class_type: 12,
        skill_branch_type: 1,
        win_count: 80,
        lose_count: 50,
        draw_count: 0,
        win_average: "61.54%",
        rank_rating: 1780,
      });

      // Polling at the SAME since=930012 with preSupersededEtag MUST return 200 OK
      // because ranking_superseded flipped false -> true, counting the loss in session!
      const postSupersededPoll = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930012&etag=${encodeURIComponent(preSupersededEtag)}`,
        { headers: { "If-None-Match": preSupersededEtag } },
      );
      expect(postSupersededPoll.status).toBe(200);
      const postSupersededEtag = postSupersededPoll.headers.get("etag");
      expect(postSupersededEtag).not.toBe(preSupersededEtag);
      const postSupersededBody = await postSupersededPoll.json();
      expect(postSupersededBody.session.wins).toBe(1);
      expect(postSupersededBody.session.losses).toBe(1);

      const postSupersededSteadyPoll = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?token=${createdSession.token}&since=930012&etag=${encodeURIComponent(postSupersededEtag)}`,
        { headers: { "If-None-Match": postSupersededEtag } },
      );
      expect(postSupersededSteadyPoll.status).toBe(304);
    });
  });
});
