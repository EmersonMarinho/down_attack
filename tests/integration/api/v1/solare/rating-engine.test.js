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

  describe("Automatic Practice Mode Mathematical Proofs & Neighbor Rating Estimation", () => {
    test("PostgreSQL triggers automatically prove Practice matches in real time, infer exact Elo, revert anchored Practice deltas, and filter APIs without deleting rows", async () => {
      // Seed anchored Rank #1 (895 Elo at record 960000, 1 Ranked win) and Rank #3 (875 Elo at record 960000)
      await orchestrator.createSolarePlayer({
        region: "JP",
        season: 9,
        user_no: 61001,
        user_nickname: "JpAnchorTop1",
        current_ranking: 1,
        class_type: 20,
        skill_branch_type: 2,
        win_count: 1,
        lose_count: 0,
        rank_rating: 895,
        rating_anchor_record_no: 960000,
        rating_achieved_record_no: 960000,
      });

      await orchestrator.createSolarePlayer({
        region: "JP",
        season: 9,
        user_no: 61003,
        user_nickname: "JpAnchorTop3",
        current_ranking: 3,
        class_type: 12,
        skill_branch_type: 1,
        win_count: 1,
        lose_count: 0,
        rank_rating: 875,
        rating_anchor_record_no: 960000,
        rating_achieved_record_no: 960000,
      });

      // Historical Ranked match 960000 for JpAnchorTop1 (already included in anchor 895)
      await orchestrator.createSolareMatch({
        region: "JP",
        season: 9,
        record_no: 960000,
        user_nickname: "JpAnchorTop1",
        user_no: 61001,
        is_winner: true,
        vary_rank_rating: 25,
      });

      // PalmitoJP plays 3 Ranked wins (+26, +28, +25 => +79, from 801 => 880 inside [875, 895])
      // plus 1 Practice Mode warmup match 960010 (+62 calibration-like PDL, no .repz) alongside JpAnchorTop1 (+18)!
      for (const [recNo, delta] of [
        [960001, 26],
        [960002, 28],
        [960003, 25],
      ]) {
        await orchestrator.createSolareMatch({
          region: "JP",
          season: 9,
          record_no: recNo,
          repz_download_url: null,
          user_nickname: "PalmitoJP",
          user_no: 61002,
          class_type: 20,
          skill_branch_type: 2,
          is_winner: true,
          vary_rank_rating: delta,
        });
      }

      // Practice Mode match 960010 (repz_download_url: null) where both PalmitoJP (+62) and JpAnchorTop1 (+18) win
      await orchestrator.createSolareMatch({
        region: "JP",
        season: 9,
        record_no: 960010,
        repz_download_url: null,
        players: [
          {
            team: 0,
            user_nickname: "PalmitoJP",
            user_no: 61002,
            class_type: 8,
            skill_branch_type: 1,
            kill_count: 9,
            death_count: 0,
            cc_applied_count: 20,
            damage_done: 250000,
            damage_taken: 50000,
            recovery: 40000,
            is_winner: true,
            vary_rank_rating: 62,
          },
          {
            team: 0,
            user_nickname: "JpAnchorTop1",
            user_no: 61001,
            class_type: 20,
            skill_branch_type: 2,
            kill_count: 4,
            death_count: 1,
            cc_applied_count: 10,
            damage_done: 140000,
            damage_taken: 70000,
            recovery: 35000,
            is_winner: true,
            vary_rank_rating: 18,
          },
          {
            team: 0,
            user_nickname: "PracticeAlly",
            user_no: 69001,
            class_type: 4,
            skill_branch_type: 1,
            is_winner: true,
            vary_rank_rating: 20,
          },
          {
            team: 1,
            user_nickname: "PracticeEnemy1",
            user_no: 69002,
            class_type: 16,
            skill_branch_type: 1,
            is_winner: false,
            vary_rank_rating: -20,
          },
          {
            team: 1,
            user_nickname: "PracticeEnemy2",
            user_no: 69003,
            class_type: 25,
            skill_branch_type: 1,
            is_winner: false,
            vary_rank_rating: -20,
          },
          {
            team: 1,
            user_nickname: "PracticeEnemy3",
            user_no: 69004,
            class_type: 30,
            skill_branch_type: 2,
            is_winner: false,
            vary_rank_rating: -20,
          },
        ],
      });

      // Before PalmitoJP enters solare_players, JpAnchorTop1 temporarily had +18 applied (895 + 18 = 913).
      // Now GetRankList inserts PalmitoJP at Rank #2 with official Ranked W/L = 3W / 0L (rank_rating: null).
      // WITHOUT calling reconcileRegionRatings, the PostgreSQL trigger must automatically:
      // 1. Prove 960010 is 'practice' ('trigger_math')
      // 2. Infer PalmitoJP's exact rating = 880 (801 + 26 + 28 + 25), rating_is_estimated = false
      // 3. Revert JpAnchorTop1's wrongful +18 delta on 960010 back to 895!
      await orchestrator.createSolarePlayer({
        region: "JP",
        season: 9,
        user_no: 61002,
        user_nickname: "PalmitoJP",
        current_ranking: 2,
        class_type: 20,
        skill_branch_type: 2,
        win_count: 3,
        lose_count: 0,
        draw_count: 0,
        rank_rating: null,
      });

      const proofRes = await database.query({
        text: "SELECT mode, method FROM solare_match_mode_proofs WHERE region = 'JP' AND record_no = 960010;",
      });
      expect(proofRes.rowCount).toBe(1);
      expect(proofRes.rows[0]).toEqual({
        mode: "practice",
        method: "trigger_math",
      });

      const anchorRes = await database.query({
        text: "SELECT rank_rating, rating_achieved_record_no FROM solare_players WHERE region = 'JP' AND user_no = 61001;",
      });
      expect(anchorRes.rows[0].rank_rating).toBe(895);
      expect(Number(anchorRes.rows[0].rating_achieved_record_no)).toBe(960000);

      // Updating a proven Practice match must also be ignored by fn_apply_solare_match_rating_delta
      await database.query({
        text: "UPDATE solare_match_players SET vary_rank_rating = 22 WHERE region = 'JP' AND record_no = 960010 AND user_no = 61001;",
      });
      const anchorAfterUpdate = await database.query({
        text: "SELECT rank_rating FROM solare_players WHERE region = 'JP' AND user_no = 61001;",
      });
      expect(anchorAfterUpdate.rows[0].rank_rating).toBe(895);

      // Zero destructive deletes: all 4 matches for PalmitoJP remain intact in PostgreSQL
      const rawDbMatches = await database.query({
        text: "SELECT COUNT(*)::int AS cnt FROM solare_match_players WHERE region = 'JP' AND user_no = 61002;",
      });
      expect(rawDbMatches.rows[0].cnt).toBe(4);

      // Player profile API excludes the proven Practice match (960010) and exposes exact rating 880
      const profileRes = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=PalmitoJP&region=JP`,
      );
      expect(profileRes.status).toBe(200);
      const profileBody = await profileRes.json();
      expect(profileBody.rank_rating).toBe(880);
      expect(profileBody.rating_is_estimated).toBe(false);
      expect(profileBody.pagination.total_matches).toBe(3);
      expect(profileBody.matches.map((m) => m.record_no)).toEqual([
        960003, 960002, 960001,
      ]);
      // Class 8 (played only in Practice match 960010) does not pollute Ranked class breakdown
      expect(profileBody.classes).toHaveLength(1);
      expect(profileBody.classes[0].class_type).toBe(20);

      // Overlay API also excludes proven Practice match 960010
      const overlayRes = await fetch(
        `${webserver.origin}/api/v1/solare/overlay?nick=PalmitoJP&region=JP`,
      );
      expect(overlayRes.status).toBe(200);
      const overlayBody = await overlayRes.json();
      expect(overlayBody.rating).toBe(880);
      expect(overlayBody.latest_record_no).toBe(960003);
    });

    test("reconcileRegionRatings cascades multi-player proofs, interpolates unsolvable neighbors within 40 pts, and upgrades estimates when matches arrive", async () => {
      // Seed TR region:
      // #1: 860 (anchored)
      // #2: TrPlayerB (official 2W 0L -> 801 + 35 + 21 = 857, has 3 wins in DB: shared 970001 (+35), Practice 970003 (+35), Ranked .repz 970004 (+21))
      // #3: 855 (anchored)
      // #4: TrPlayerA (official 1W 0L -> 801 + 35 = 836, has 2 wins in DB: shared 970001 (+35), Practice 970002 (+65))
      // #5: 834 (anchored)
      // #6: TrEstimated (official 40W 30L, 0 crawled matches in DB -> sandwiched between #5=834 and #7=814 => interpolated to 824, rating_is_estimated=true)
      // #7: 814 (anchored)
      await orchestrator.createSolarePlayer({
        region: "TR",
        season: 9,
        user_no: 71001,
        user_nickname: "TrAnchor1",
        current_ranking: 1,
        win_count: 10,
        lose_count: 0,
        rank_rating: 860,
        rating_anchor_record_no: 970000,
        rating_achieved_record_no: 970000,
      });
      await orchestrator.createSolarePlayer({
        region: "TR",
        season: 9,
        user_no: 71003,
        user_nickname: "TrAnchor3",
        current_ranking: 3,
        win_count: 10,
        lose_count: 0,
        rank_rating: 855,
        rating_anchor_record_no: 970000,
        rating_achieved_record_no: 970000,
      });
      await orchestrator.createSolarePlayer({
        region: "TR",
        season: 9,
        user_no: 71005,
        user_nickname: "TrAnchor5",
        current_ranking: 5,
        win_count: 10,
        lose_count: 0,
        rank_rating: 834,
        rating_anchor_record_no: 970000,
        rating_achieved_record_no: 970000,
      });
      await orchestrator.createSolarePlayer({
        region: "TR",
        season: 9,
        user_no: 71007,
        user_nickname: "TrAnchor7",
        current_ranking: 7,
        win_count: 10,
        lose_count: 0,
        rank_rating: 814,
        rating_anchor_record_no: 970000,
        rating_achieved_record_no: 970000,
      });

      // Match 970001: shared win by TrPlayerA (+35) and TrPlayerB (+35), no .repz
      await orchestrator.createSolareMatch({
        region: "TR",
        season: 9,
        record_no: 970001,
        repz_download_url: null,
        players: [
          {
            team: 0,
            user_nickname: "TrPlayerA",
            user_no: 71004,
            class_type: 20,
            skill_branch_type: 2,
            is_winner: true,
            vary_rank_rating: 35,
          },
          {
            team: 0,
            user_nickname: "TrPlayerB",
            user_no: 71002,
            class_type: 12,
            skill_branch_type: 2,
            is_winner: true,
            vary_rank_rating: 35,
          },
          {
            team: 0,
            user_nickname: "TrFiller1",
            user_no: 79001,
            class_type: 4,
            skill_branch_type: 1,
            is_winner: true,
            vary_rank_rating: 25,
          },
          {
            team: 1,
            user_nickname: "TrFiller2",
            user_no: 79002,
            class_type: 8,
            skill_branch_type: 1,
            is_winner: false,
            vary_rank_rating: -25,
          },
          {
            team: 1,
            user_nickname: "TrFiller3",
            user_no: 79003,
            class_type: 16,
            skill_branch_type: 1,
            is_winner: false,
            vary_rank_rating: -25,
          },
          {
            team: 1,
            user_nickname: "TrFiller4",
            user_no: 79004,
            class_type: 25,
            skill_branch_type: 1,
            is_winner: false,
            vary_rank_rating: -25,
          },
        ],
      });

      // Match 970002: TrPlayerA's Practice win (+65, no .repz)
      await orchestrator.createSolareMatch({
        region: "TR",
        season: 9,
        record_no: 970002,
        repz_download_url: null,
        user_nickname: "TrPlayerA",
        user_no: 71004,
        is_winner: true,
        vary_rank_rating: 65,
      });

      // Match 970003: TrPlayerB's Practice win (+35, no .repz — same +35 as 970001, so B needs A's Ranked proof on 970001 to disambiguate which match is Practice!)
      await orchestrator.createSolareMatch({
        region: "TR",
        season: 9,
        record_no: 970003,
        repz_download_url: null,
        user_nickname: "TrPlayerB",
        user_no: 71002,
        is_winner: true,
        vary_rank_rating: 35,
      });

      // Match 970004: TrPlayerB's Ranked .repz win (+21)
      await orchestrator.createSolareMatch({
        region: "TR",
        season: 9,
        record_no: 970004,
        user_nickname: "TrPlayerB",
        user_no: 71002,
        is_winner: true,
        vary_rank_rating: 21,
      });

      await orchestrator.createSolarePlayer({
        region: "TR",
        season: 9,
        user_no: 71002,
        user_nickname: "TrPlayerB",
        current_ranking: 2,
        win_count: 2,
        lose_count: 0,
        rank_rating: null,
      });
      await orchestrator.createSolarePlayer({
        region: "TR",
        season: 9,
        user_no: 71004,
        user_nickname: "TrPlayerA",
        current_ranking: 4,
        win_count: 1,
        lose_count: 0,
        rank_rating: null,
      });
      await orchestrator.createSolarePlayer({
        region: "TR",
        season: 9,
        user_no: 71006,
        user_nickname: "TrEstimated",
        current_ranking: 6,
        win_count: 1,
        lose_count: 0,
        rank_rating: null,
      });

      // Before reconcileRegionRatings, 970003 couldn't be disambiguated from 970001 by TrPlayerB alone
      const reconcileRes = await solare.reconcileRegionRatings({
        region: "TR",
        season: 9,
      });
      expect(reconcileRes.discrepancies).toHaveLength(0);
      expect(reconcileRes.provenPractice).toBe(2);
      expect(reconcileRes.provenRanked).toBe(1);

      const trProofs = await database.query({
        text: "SELECT record_no::int AS record_no, mode FROM solare_match_mode_proofs WHERE region = 'TR' ORDER BY record_no ASC;",
      });
      expect(trProofs.rows).toEqual([
        { record_no: 970001, mode: "ranked" },
        { record_no: 970002, mode: "practice" },
        { record_no: 970003, mode: "practice" },
      ]);

      // TrPlayerB profile now hides Practice match 970003 while keeping Ranked 970001 & 970004
      const playerBRes = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=TrPlayerB&region=TR`,
      );
      const playerBBody = await playerBRes.json();
      expect(playerBBody.rank_rating).toBe(857);
      expect(playerBBody.rating_is_estimated).toBe(false);
      expect(playerBBody.matches.map((m) => m.record_no)).toEqual([
        970004, 970001,
      ]);

      // TrEstimated was automatically interpolated between #5 (834) and #7 (814) -> 824 (rating_is_estimated: true)
      let estProfileRes = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=TrEstimated&region=TR`,
      );
      let estProfileBody = await estProfileRes.json();
      expect(estProfileBody.rank_rating).toBe(824);
      expect(estProfileBody.rating_is_estimated).toBe(true);

      // Once TrEstimated's Ranked match arrives (+20 from 801 => 821, inside [814, 834]),
      // trigger automatically upgrades TrEstimated from estimated (824) to exact (821, rating_is_estimated: false)!
      await orchestrator.createSolareMatch({
        region: "TR",
        season: 9,
        record_no: 970010,
        user_nickname: "TrEstimated",
        user_no: 71006,
        is_winner: true,
        vary_rank_rating: 20,
      });

      estProfileRes = await fetch(
        `${webserver.origin}/api/v1/solare/player?nick=TrEstimated&region=TR`,
      );
      estProfileBody = await estProfileRes.json();
      expect(estProfileBody.rank_rating).toBe(821);
      expect(estProfileBody.rating_is_estimated).toBe(false);
    });

    test("handles multi-event Practice rollback, self-healing delta restoration with manual override protection, and contradicted trigger candidates safely", async () => {
      // --- 1. Multi-event rollback (RU): Practice 980010 (+18) followed by Ranked 980020 (+24) ---
      await orchestrator.createSolarePlayer({
        region: "RU",
        season: 9,
        user_no: 81001,
        user_nickname: "RuAnchor1",
        current_ranking: 1,
        win_count: 10,
        lose_count: 2,
        rank_rating: 900,
        rating_anchor_record_no: 980000,
        rating_achieved_record_no: 980000,
      });

      await orchestrator.createSolareMatch({
        region: "RU",
        season: 9,
        record_no: 980010,
        repz_download_url: null,
        user_nickname: "RuAnchor1",
        user_no: 81001,
        is_winner: true,
        vary_rank_rating: 18,
      });

      await orchestrator.createSolareMatch({
        region: "RU",
        season: 9,
        record_no: 980020,
        user_nickname: "RuAnchor1",
        user_no: 81001,
        is_winner: true,
        vary_rank_rating: 24,
      });

      // Before proof: 900 + 18 + 24 = 942, achieved at 980020
      let ruAnchor = await database.query({
        text: "SELECT rank_rating, rating_achieved_record_no::int AS achieved FROM solare_players WHERE region = 'RU' AND user_no = 81001;",
      });
      expect(ruAnchor.rows[0]).toEqual({ rank_rating: 942, achieved: 980020 });

      // Proving 980010 as 'practice' subtracts +18 (942 -> 924) while preserving achieved = 980020!
      await database.query({
        text: "INSERT INTO solare_match_mode_proofs (region, record_no, mode, method) VALUES ('RU', 980010, 'practice', 'math');",
      });

      ruAnchor = await database.query({
        text: "SELECT rank_rating, rating_achieved_record_no::int AS achieved FROM solare_players WHERE region = 'RU' AND user_no = 81001;",
      });
      expect(ruAnchor.rows[0]).toEqual({ rank_rating: 924, achieved: 980020 });

      // --- 2. Self-healing cycle + manual override protection ---
      // Manual 'practice' override on 980030 must NEVER be deleted or overwritten even when excess <= 0
      await orchestrator.createSolareMatch({
        region: "RU",
        season: 9,
        record_no: 980030,
        repz_download_url: null,
        user_nickname: "RuAnchor1",
        user_no: 81001,
        is_winner: true,
        vary_rank_rating: 19,
      });
      await database.query({
        text: "INSERT INTO solare_match_mode_proofs (region, record_no, mode, method) VALUES ('RU', 980030, 'practice', 'manual');",
      });

      ruAnchor = await database.query({
        text: "SELECT rank_rating FROM solare_players WHERE region = 'RU' AND user_no = 81001;",
      });
      expect(ruAnchor.rows[0].rank_rating).toBe(924);

      // Fresh GetRankList updates RuAnchor1 to win_count = 15 (DB has 3 wins -> excess.w = 3 - 15 = -12 <= 0!).
      // proveRegionMatchModes must invalidate & delete 'math' proof 980010 (restoring +18 -> 942),
      // while keeping 'manual' proof 980030 intact!
      await orchestrator.createSolarePlayer({
        region: "RU",
        season: 9,
        user_no: 81001,
        user_nickname: "RuAnchor1",
        current_ranking: 1,
        win_count: 15,
        lose_count: 2,
        rank_rating: 924,
        rating_anchor_record_no: 980000,
        rating_achieved_record_no: 980020,
      });

      const healRes = await solare.proveRegionMatchModes({
        region: "RU",
        season: 9,
      });
      expect(healRes.deletedCount).toBe(1);

      const remainingRuProofs = await database.query({
        text: "SELECT record_no::int AS record_no, mode, method FROM solare_match_mode_proofs WHERE region = 'RU' ORDER BY record_no ASC;",
      });
      expect(remainingRuProofs.rows).toEqual([
        { record_no: 980030, mode: "practice", method: "manual" },
      ]);

      // Anchored player's +18 match_delta on 980010 was automatically restored (924 + 18 = 942)!
      ruAnchor = await database.query({
        text: "SELECT rank_rating, rating_achieved_record_no::int AS achieved FROM solare_players WHERE region = 'RU' AND user_no = 81001;",
      });
      expect(ruAnchor.rows[0]).toEqual({ rank_rating: 942, achieved: 980020 });

      // --- 3. Contradicted candidate in trigger must NOT fall through to false raw-sum exact Elo (TW) ---
      // Bracket [740, 840] (gap 100 > 40). Unseeded TwTarget has 1W official, 2W in DB (+25 and +65 = +90).
      // Excluding +65 fits 801 + 25 = 826 inside [740, 840], BUT match 990002 (+65) is contradicted by TwExact (excess = 0).
      // Crucially, raw sum +90 from base 701 would be 701 + 90 = 791 (inside [740, 840]!), which MUST NOT be written!
      await orchestrator.createSolarePlayer({
        region: "TW",
        season: 9,
        user_no: 91001,
        user_nickname: "TwTop1",
        current_ranking: 1,
        win_count: 20,
        lose_count: 5,
        rank_rating: 840,
        rating_anchor_record_no: 990000,
        rating_achieved_record_no: 990000,
      });
      await orchestrator.createSolarePlayer({
        region: "TW",
        season: 9,
        user_no: 91003,
        user_nickname: "TwTop3",
        current_ranking: 3,
        win_count: 20,
        lose_count: 8,
        rank_rating: 740,
        rating_anchor_record_no: 990000,
        rating_achieved_record_no: 990000,
      });
      await orchestrator.createSolarePlayer({
        region: "TW",
        season: 9,
        user_no: 91050,
        user_nickname: "TwExact",
        current_ranking: 50,
        win_count: 1,
        lose_count: 0,
        rank_rating: 710,
        rating_anchor_record_no: 990000,
        rating_achieved_record_no: 990000,
      });

      await orchestrator.createSolareMatch({
        region: "TW",
        season: 9,
        record_no: 990001,
        repz_download_url: null,
        user_nickname: "TwTarget",
        user_no: 91002,
        is_winner: true,
        vary_rank_rating: 25,
      });
      await orchestrator.createSolareMatch({
        region: "TW",
        season: 9,
        record_no: 990002,
        repz_download_url: null,
        players: [
          {
            team: 0,
            user_nickname: "TwTarget",
            user_no: 91002,
            class_type: 20,
            skill_branch_type: 2,
            is_winner: true,
            vary_rank_rating: 65,
          },
          {
            team: 0,
            user_nickname: "TwExact",
            user_no: 91050,
            class_type: 12,
            skill_branch_type: 1,
            is_winner: true,
            vary_rank_rating: 25,
          },
          {
            team: 0,
            user_nickname: "TwAlly",
            user_no: 99011,
            class_type: 4,
            skill_branch_type: 1,
            is_winner: true,
            vary_rank_rating: 25,
          },
          {
            team: 1,
            user_nickname: "TwEn1",
            user_no: 99012,
            class_type: 8,
            skill_branch_type: 1,
            is_winner: false,
            vary_rank_rating: -25,
          },
          {
            team: 1,
            user_nickname: "TwEn2",
            user_no: 99013,
            class_type: 16,
            skill_branch_type: 1,
            is_winner: false,
            vary_rank_rating: -25,
          },
          {
            team: 1,
            user_nickname: "TwEn3",
            user_no: 99014,
            class_type: 25,
            skill_branch_type: 1,
            is_winner: false,
            vary_rank_rating: -25,
          },
        ],
      });

      await orchestrator.createSolarePlayer({
        region: "TW",
        season: 9,
        user_no: 91002,
        user_nickname: "TwTarget",
        current_ranking: 2,
        win_count: 1,
        lose_count: 0,
        rank_rating: null,
      });

      const twProofs = await database.query({
        text: "SELECT * FROM solare_match_mode_proofs WHERE region = 'TW';",
      });
      expect(twProofs.rowCount).toBe(0);

      const twTarget = await database.query({
        text: "SELECT rank_rating, rating_is_estimated FROM solare_players WHERE region = 'TW' AND user_no = 91002;",
      });
      expect(twTarget.rows[0].rank_rating).toBeNull();
      expect(twTarget.rows[0].rating_is_estimated).toBe(false);
    });
  });
});
