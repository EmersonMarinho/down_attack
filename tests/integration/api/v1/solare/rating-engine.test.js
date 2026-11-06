import orchestrator from "tests/orchestrator.js";
import webserver from "~~/infra/webserver.js";
import database from "~~/infra/database.js";
import solare from "~~/server/utils/solare.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

describe("Solare Continuous Elo Rating Engine", () => {
  test("PostgreSQL trigger progresses rank_rating on new matches, ignores old matches, and is idempotent", async () => {
    await orchestrator.createSolarePlayer({
      region: "SA",
      season: 9,
      user_no: 7001,
      user_nickname: "N4SCIMENTO",
      current_ranking: 1,
      class_type: 20,
      skill_branch_type: 2,
      win_count: 100,
      lose_count: 50,
      rank_rating: 2150,
      rating_anchor_record_no: 950000,
      rating_achieved_record_no: 950000,
    });

    // 1. Historical match at or before anchor watermark (949999 <= 950000) -> ignored
    await orchestrator.createSolareMatch({
      region: "SA",
      season: 9,
      record_no: 949999,
      user_nickname: "N4SCIMENTO",
      user_no: 7001,
      is_winner: true,
      vary_rank_rating: 25,
    });

    let playerRow = await database.query({
      text: "SELECT rank_rating, rating_achieved_record_no FROM solare_players WHERE region = 'SA' AND user_no = 7001;",
    });
    expect(playerRow.rows[0].rank_rating).toBe(2150);
    expect(Number(playerRow.rows[0].rating_achieved_record_no)).toBe(950000);

    // 2. New match after anchor watermark (950001 > 950000) with +26 -> 2176
    await orchestrator.createSolareMatch({
      region: "SA",
      season: 9,
      record_no: 950001,
      user_nickname: "N4SCIMENTO",
      user_no: 7001,
      is_winner: true,
      vary_rank_rating: 26,
    });

    playerRow = await database.query({
      text: "SELECT rank_rating, rating_achieved_record_no FROM solare_players WHERE region = 'SA' AND user_no = 7001;",
    });
    expect(playerRow.rows[0].rank_rating).toBe(2176);
    expect(Number(playerRow.rows[0].rating_achieved_record_no)).toBe(950001);

    // 3. Re-updating the same match (950001) must be idempotent (no duplicate delta)
    await database.query({
      text: "UPDATE solare_match_players SET vary_rank_rating = 26 WHERE region = 'SA' AND record_no = 950001 AND user_no = 7001;",
    });

    playerRow = await database.query({
      text: "SELECT rank_rating FROM solare_players WHERE region = 'SA' AND user_no = 7001;",
    });
    expect(playerRow.rows[0].rank_rating).toBe(2176);

    const eventsResult = await database.query({
      text: "SELECT * FROM solare_player_rating_events WHERE region = 'SA' AND user_no = 7001 AND event_type = 'match_delta';",
    });
    expect(eventsResult.rowCount).toBe(1);
    expect(eventsResult.rows[0].previous_rating).toBe(2150);
    expect(eventsResult.rows[0].rating_delta).toBe(26);
    expect(eventsResult.rows[0].new_rating).toBe(2176);
  });

  test("API endpoints expose rank_rating and allow automatic overlay session creation without manual rating input", async () => {
    // 1. Ranking endpoint includes rank_rating
    const rankingRes = await fetch(
      `${webserver.origin}/api/v1/solare/ranking?region=SA`,
    );
    expect(rankingRes.status).toBe(200);
    const rankingBody = await rankingRes.json();
    expect(rankingBody.players[0].user_nickname).toBe("N4SCIMENTO");
    expect(rankingBody.players[0].rank_rating).toBe(2176);

    // 2. Player profile endpoint includes rank_rating
    const profileRes = await fetch(
      `${webserver.origin}/api/v1/solare/player?nick=N4SCIMENTO&region=SA`,
    );
    expect(profileRes.status).toBe(200);
    const profileBody = await profileRes.json();
    expect(profileBody.rank_rating).toBe(2176);

    // 3. Overlay endpoint without token returns rating from rank_rating
    const overlayRes = await fetch(
      `${webserver.origin}/api/v1/solare/overlay?nick=N4SCIMENTO&region=SA`,
    );
    expect(overlayRes.status).toBe(200);
    const overlayBody = await overlayRes.json();
    expect(overlayBody.rating).toBe(2176);

    // 4. Starting a new overlay session WITHOUT rating auto-initializes from rank_rating
    const sessionRes = await fetch(
      `${webserver.origin}/api/v1/solare/session`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nick: "N4SCIMENTO",
          region: "SA",
        }),
      },
    );
    expect(sessionRes.status).toBe(201);
    const sessionBody = await sessionRes.json();
    expect(sessionBody.anchor_rating).toBe(2176);
    expect(sessionBody.anchor_record_no).toBe("950001");
  });

  test("Inactivity decay applies official tier penalties, floors at 1800, and is idempotent", async () => {
    const fourDaysAgo = new Date(
      Date.now() - 4 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await orchestrator.createSolarePlayer({
      region: "NA",
      season: 9,
      user_no: 8001,
      user_nickname: "InactiveRedSpear",
      current_ranking: 1,
      rank_rating: 2450,
      rating_achieved_at: fourDaysAgo,
    });

    await orchestrator.createSolarePlayer({
      region: "NA",
      season: 9,
      user_no: 8002,
      user_nickname: "BorderlineDiamond",
      current_ranking: 50,
      rank_rating: 1810,
      rating_achieved_at: fourDaysAgo,
    });

    const nowIso = new Date().toISOString();

    // First decay run:
    // - InactiveRedSpear (2450, 4 days inactive -> grace 2d + 2 additional days = 3 intervals * -50 = -150 -> 2300)
    // - BorderlineDiamond (1810, 4 days inactive -> grace 3d -> 1 interval * -30, floored at 1800 -> 1800)
    const decayRun1 = await solare.applyInactivityDecay({
      region: "NA",
      season: 9,
      now: nowIso,
    });

    expect(decayRun1.decayedCount).toBe(2);
    const redSpearDecay = decayRun1.players.find(
      (p) => p.user_nickname === "InactiveRedSpear",
    );
    const diamondDecay = decayRun1.players.find(
      (p) => p.user_nickname === "BorderlineDiamond",
    );

    expect(redSpearDecay.rating_after).toBe(2300);
    expect(diamondDecay.rating_after).toBe(1800);

    // Second decay run at the same timestamp must be idempotent (0 players decayed)
    const decayRun2 = await solare.applyInactivityDecay({
      region: "NA",
      season: 9,
      now: nowIso,
    });
    expect(decayRun2.decayedCount).toBe(0);
  });

  test("Reconciliation updates anchors and detects monotonicity discrepancies", async () => {
    await orchestrator.createSolarePlayer({
      region: "EU",
      season: 9,
      user_no: 9001,
      user_nickname: "EuRank1",
      current_ranking: 1,
      rank_rating: 2100,
    });

    await orchestrator.createSolarePlayer({
      region: "EU",
      season: 9,
      user_no: 9002,
      user_nickname: "EuRank2",
      current_ranking: 2,
      rank_rating: 2200,
    });

    // Audit detects that Rank #1 (2100) < Rank #2 (2200)
    const auditBefore = await solare.reconcileRegionRatings({
      region: "EU",
      season: 9,
    });
    expect(auditBefore.discrepancies).toHaveLength(1);
    expect(auditBefore.discrepancies[0]).toMatchObject({
      higher_rank: 1,
      higher_nick: "EuRank1",
      higher_rating: 2100,
      lower_rank: 2,
      lower_nick: "EuRank2",
      lower_rating: 2200,
    });

    // Reconcile EuRank1 to 2250 -> discrepancy resolved
    const auditAfter = await solare.reconcileRegionRatings({
      region: "EU",
      season: 9,
      anchors: [{ user_nickname: "EuRank1", rank_rating: 2250 }],
    });
    expect(auditAfter.reconciledCount).toBe(1);
    expect(auditAfter.discrepancies).toHaveLength(0);
  });

  test("Season reset maps ratings to official soft-reset tiers and clears watermarks to NULL", async () => {
    expect(solare.getSeasonResetStartingRating(2450)).toBe(801);
    expect(solare.getSeasonResetStartingRating(2101)).toBe(801);
    expect(solare.getSeasonResetStartingRating(2100)).toBe(701);
    expect(solare.getSeasonResetStartingRating(1801)).toBe(701);
    expect(solare.getSeasonResetStartingRating(1550)).toBe(601);
    expect(solare.getSeasonResetStartingRating(1250)).toBe(501);
    expect(solare.getSeasonResetStartingRating(1100)).toBe(401);
    expect(solare.getSeasonResetStartingRating(null)).toBe(401);

    const resetResult = await solare.resetSeasonRatings({
      region: "EU",
      fromSeason: 9,
      toSeason: 10,
    });
    expect(resetResult.resetCount).toBe(2);
    expect(resetResult.toSeason).toBe(10);

    const euPlayers = await database.query({
      text: "SELECT user_nickname, season, rank_rating, rating_anchor_record_no, rating_achieved_record_no FROM solare_players WHERE region = 'EU' ORDER BY current_ranking ASC;",
    });
    expect(euPlayers.rows[0]).toEqual({
      user_nickname: "EuRank1",
      season: 10,
      rank_rating: 801,
      rating_anchor_record_no: null,
      rating_achieved_record_no: null,
    });
  });

  describe("5 New Player Climbs (+1450 pts from 401, 501, 601, 701, 801 into Top 100)", () => {
    // Realistic sequence of 35 victories (MD10 placement jumps + regular wins with streak bonuses) totaling +1450 points:
    // 10 placement wins: [65, 62, 60, 58, 55, 54, 52, 50, 48, 46] = +550
    // 25 regular wins with streak bonus: 25 * 36 = +900
    // Total = +1450 points
    const VICTORY_DELTAS_SUM_1450 = [
      65, 62, 60, 58, 55, 54, 52, 50, 48, 46, 36, 36, 36, 36, 36, 36, 36, 36,
      36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36,
    ];

    function getBaselineRatingForRank(rank) {
      if (rank === 1) return 2350;
      if (rank === 2) return 2280;
      if (rank <= 7) return 2240 - (rank - 3) * 20; // #3=2240 .. #7=2160
      if (rank <= 24) return 2145 - (rank - 8) * 5; // #8=2145 .. #24=2065
      if (rank <= 43) return 2045 - (rank - 25) * 4; // #25=2045 .. #43=1973
      if (rank <= 92) return 1948 - (rank - 44) * 2; // #44=1948 .. #92=1852
      return 1850 - (rank - 93) * 2; // #93=1850 .. #100=1836
    }

    async function seedBaselineTop100(region = "KR") {
      await database.query({
        text: `
          WITH del_events AS (
            DELETE FROM solare_player_rating_events WHERE region = $1
          ),
          del_mp AS (
            DELETE FROM solare_match_players WHERE region = $1
          ),
          del_m AS (
            DELETE FROM solare_matches WHERE region = $1
          )
          DELETE FROM solare_players WHERE region = $1;
        `,
        values: [region],
      });

      for (let r = 1; r <= 100; r += 1) {
        const rating = getBaselineRatingForRank(r);
        await orchestrator.createSolarePlayer({
          region,
          season: 9,
          user_no: 100000 + r,
          user_nickname: `KrTop${r}`,
          current_ranking: r,
          class_type: 20,
          skill_branch_type: 2,
          win_count: 90,
          lose_count: 50,
          rank_rating: rating,
          rating_anchor_record_no: 800000,
          rating_achieved_record_no: 800000 + r,
        });
      }
    }

    async function insertVictorySeries({
      region,
      userNo,
      nick,
      startRecordNo,
      deltas,
    }) {
      for (let i = 0; i < deltas.length; i += 1) {
        const recordNo = startRecordNo + i;
        const delta = deltas[i];
        await database.query({
          text: `
            INSERT INTO solare_matches (region, season, record_no, play_time_seconds, win_record, match_date)
            VALUES ($1, 9, $2, 210, ARRAY[2, 2], NOW())
            ON CONFLICT (region, record_no) DO NOTHING;
          `,
          values: [region, recordNo],
        });
        await database.query({
          text: `
            INSERT INTO solare_match_players (
              region, record_no, team, user_nickname, user_no, class_type, skill_branch_type,
              kill_count, death_count, cc_applied_count, damage_done, damage_taken, recovery,
              is_winner, vary_rank_rating
            )
            VALUES ($1, $2, 0, $3, $4, 20, 2, 4, 1, 10, 120000, 80000, 50000, true, $5);
          `,
          values: [region, recordNo, nick, userNo, delta],
        });
      }
    }

    const FIVE_STARTING_CASES = [
      {
        startRating: 401,
        expectedFinalRating: 1851,
        expectedRank: 93,
        userNo: 990401,
        nick: "NewClimber401",
      },
      {
        startRating: 501,
        expectedFinalRating: 1951,
        expectedRank: 44,
        userNo: 990501,
        nick: "NewClimber501",
      },
      {
        startRating: 601,
        expectedFinalRating: 2051,
        expectedRank: 25,
        userNo: 990601,
        nick: "NewClimber601",
      },
      {
        startRating: 701,
        expectedFinalRating: 2151,
        expectedRank: 8,
        userNo: 990701,
        nick: "NewClimber701",
      },
      {
        startRating: 801,
        expectedFinalRating: 2251,
        expectedRank: 3,
        userNo: 990801,
        nick: "NewClimber801",
      },
    ];

    for (const testCase of FIVE_STARTING_CASES) {
      test(`New player starting at ${testCase.startRating} Elo with +1450 pts reaches ${testCase.expectedFinalRating} Elo and Rank #${testCase.expectedRank} (both live & seedless)`, async () => {
        const totalGain = VICTORY_DELTAS_SUM_1450.reduce(
          (acc, d) => acc + d,
          0,
        );
        expect(totalGain).toBe(1450);

        // --- PART 1: Live Intraday Climb from starting Elo (401..801) into Top 100 ---
        await seedBaselineTop100("KR");

        // Player starts outside Top 100 (official rank #250) with their official starting Elo
        await orchestrator.createSolarePlayer({
          region: "KR",
          season: 9,
          user_no: testCase.userNo,
          user_nickname: testCase.nick,
          current_ranking: 250,
          class_type: 20,
          skill_branch_type: 2,
          win_count: 35,
          lose_count: 0,
          rank_rating: testCase.startRating,
          rating_anchor_record_no: null,
          rating_achieved_record_no: null,
        });

        await insertVictorySeries({
          region: "KR",
          userNo: testCase.userNo,
          nick: testCase.nick,
          startRecordNo: 900000,
          deltas: VICTORY_DELTAS_SUM_1450,
        });

        // Verify exact Elo progression via trigger and live hybrid ranking position
        const rankingRes = await fetch(
          `${webserver.origin}/api/v1/solare/ranking?region=KR`,
        );
        expect(rankingRes.status).toBe(200);
        const rankingBody = await rankingRes.json();

        const liveEntry = rankingBody.players.find(
          (p) => p.user_nickname === testCase.nick,
        );
        expect(liveEntry).toBeDefined();
        expect(liveEntry.rank_rating).toBe(testCase.expectedFinalRating);
        expect(liveEntry.rank).toBe(testCase.expectedRank);

        // --- PART 2: Seedless Inference (player created WITHOUT seed rank_rating: null) ---
        await seedBaselineTop100("KR");

        // Shift baseline ranks >= expectedRank down by 1 to simulate GetRankList placing the new player at expectedRank
        await database.query({
          text: `
            UPDATE solare_players
            SET current_ranking = current_ranking + 1
            WHERE region = 'KR' AND current_ranking >= $1;
          `,
          values: [testCase.expectedRank],
        });

        // Create the new player WITHOUT any seed (rank_rating: null) at expectedRank
        await orchestrator.createSolarePlayer({
          region: "KR",
          season: 9,
          user_no: testCase.userNo,
          user_nickname: testCase.nick,
          current_ranking: testCase.expectedRank,
          class_type: 20,
          skill_branch_type: 2,
          win_count: 35,
          lose_count: 0,
          rank_rating: null,
          rating_anchor_record_no: null,
          rating_achieved_record_no: null,
        });

        await insertVictorySeries({
          region: "KR",
          userNo: testCase.userNo,
          nick: testCase.nick,
          startRecordNo: 910000,
          deltas: VICTORY_DELTAS_SUM_1450,
        });

        // Engine must deduce the exact starting Elo (401..801) and exact current Elo (1851..2251) without any seed!
        const profileRes = await fetch(
          `${webserver.origin}/api/v1/solare/player?nick=${testCase.nick}&region=KR`,
        );
        expect(profileRes.status).toBe(200);
        const profileBody = await profileRes.json();

        expect(profileBody.rank_rating).toBe(testCase.expectedFinalRating);
        expect(profileBody.current_ranking).toBe(testCase.expectedRank);

        const inferredEventRes = await database.query({
          text: `
            SELECT previous_rating, rating_delta, new_rating, metadata
            FROM solare_player_rating_events
            WHERE region = 'KR' AND user_no = $1 AND event_type = 'inferred_start';
          `,
          values: [testCase.userNo],
        });
        expect(inferredEventRes.rowCount).toBe(1);
        expect(inferredEventRes.rows[0].previous_rating).toBe(
          testCase.startRating,
        );
        expect(inferredEventRes.rows[0].rating_delta).toBe(1450);
        expect(inferredEventRes.rows[0].new_rating).toBe(
          testCase.expectedFinalRating,
        );
        expect(inferredEventRes.rows[0].metadata.inferred_start_rating).toBe(
          testCase.startRating,
        );
      });
    }
  });
});
