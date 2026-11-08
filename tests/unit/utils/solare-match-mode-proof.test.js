import { computeMatchModeProofs } from "~~/server/utils/solareMatchModeProof.js";
import solare from "~~/server/utils/solare.js";

describe("server/utils/solareMatchModeProof.js", () => {
  describe(".computeMatchModeProofs()", () => {
    test("proves Ranked via wl_exact only when >= 2 ranked participants have exact official W/L/D", () => {
      const players = [
        {
          user_no: 101,
          current_ranking: 10,
          win_count: 1,
          lose_count: 0,
          draw_count: 0,
        },
        {
          user_no: 102,
          current_ranking: 11,
          win_count: 1,
          lose_count: 0,
          draw_count: 0,
        },
        {
          user_no: 103,
          current_ranking: 12,
          win_count: 1,
          lose_count: 0,
          draw_count: 0,
        },
      ];

      const matchRows = [
        // Match 1000: 2 exact players (101 and 102) -> proven ranked via wl_exact
        {
          record_no: 1000,
          repz: false,
          user_no: 101,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
        {
          record_no: 1000,
          repz: false,
          user_no: 102,
          is_winner: true,
          vary_rank_rating: 26,
          has_winner: true,
        },
        {
          record_no: 1000,
          repz: false,
          user_no: 999,
          is_winner: false,
          vary_rank_rating: -24,
          has_winner: true,
        },

        // Match 1001: only 1 exact player (103) -> NOT proven (1 Practice + 1 missing Ranked could cancel)
        {
          record_no: 1001,
          repz: false,
          user_no: 103,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
        {
          record_no: 1001,
          repz: false,
          user_no: 998,
          is_winner: false,
          vary_rank_rating: -25,
          has_winner: true,
        },
      ];

      const { proofs, stats } = computeMatchModeProofs({ players, matchRows });

      expect(proofs.get(1000)).toEqual({ mode: "ranked", method: "wl_exact" });
      expect(proofs.has(1001)).toBe(false);
      expect(stats.provenRanked).toBe(1);
      expect(stats.provenPractice).toBe(0);
      expect(stats.conflicts).toBe(0);
    });

    test("uniquely proves Practice and Ranked matches via combinatorial PDL + neighbor rating bounds", () => {
      // Target player #5 sits between #4 (885) and #6 (875).
      // Official Ranked W/L: 3W / 0L (started at 801 + 26 + 28 + 25 = 880, inside [875, 885]).
      // DB has 5 wins: 3 Ranked (+26, +28, +25) + 2 Practice calibration wins (+60, +55).
      // Excluding {+60, +55} leaves +79 -> 801 + 79 = 880 (fits [875, 885]).
      // Any other 2-win exclusion leaves >= +106 -> 401+106=507, 701+106=807 (<875), 801+106=907 (>885)!
      const players = [
        {
          user_no: 1,
          current_ranking: 4,
          win_count: 20,
          lose_count: 10,
          rank_rating: 885,
        },
        {
          user_no: 2,
          current_ranking: 5,
          win_count: 3,
          lose_count: 0,
          rank_rating: null,
        },
        {
          user_no: 3,
          current_ranking: 6,
          win_count: 18,
          lose_count: 12,
          rank_rating: 875,
        },
      ];

      const matchRows = [
        {
          record_no: 2001,
          repz: false,
          user_no: 2,
          is_winner: true,
          vary_rank_rating: 26,
          has_winner: true,
        },
        {
          record_no: 2002,
          repz: false,
          user_no: 2,
          is_winner: true,
          vary_rank_rating: 60,
          has_winner: true,
        },
        {
          record_no: 2003,
          repz: false,
          user_no: 2,
          is_winner: true,
          vary_rank_rating: 28,
          has_winner: true,
        },
        {
          record_no: 2004,
          repz: false,
          user_no: 2,
          is_winner: true,
          vary_rank_rating: 55,
          has_winner: true,
        },
        {
          record_no: 2005,
          repz: false,
          user_no: 2,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
      ];

      const { proofs, stats } = computeMatchModeProofs({ players, matchRows });

      expect(proofs.get(2002)).toEqual({ mode: "practice", method: "math" });
      expect(proofs.get(2004)).toEqual({ mode: "practice", method: "math" });
      expect(proofs.get(2001)).toEqual({ mode: "ranked", method: "math" });
      expect(proofs.get(2003)).toEqual({ mode: "ranked", method: "math" });
      expect(proofs.get(2005)).toEqual({ mode: "ranked", method: "math" });
      expect(stats.provenPractice).toBe(2);
      expect(stats.provenRanked).toBe(3);
      expect(stats.conflicts).toBe(0);
    });

    test("ignores estimated neighbor ratings when forming hard mathematical brackets", () => {
      // Exact neighbors: #4 (890) and #8 (870).
      // #6 has an estimated rating (888, rating_is_estimated: true) which would wrongly exclude 880 if used as lower bound of #5!
      const players = [
        {
          user_no: 10,
          current_ranking: 4,
          win_count: 10,
          lose_count: 5,
          rank_rating: 890,
          rating_is_estimated: false,
        },
        {
          user_no: 11,
          current_ranking: 5,
          win_count: 3,
          lose_count: 0,
          rank_rating: null,
        },
        {
          user_no: 12,
          current_ranking: 6,
          win_count: 10,
          lose_count: 5,
          rank_rating: 888,
          rating_is_estimated: true,
        },
        {
          user_no: 13,
          current_ranking: 8,
          win_count: 10,
          lose_count: 5,
          rank_rating: 870,
          rating_is_estimated: false,
        },
      ];

      const matchRows = [
        {
          record_no: 2101,
          repz: false,
          user_no: 11,
          is_winner: true,
          vary_rank_rating: 26,
          has_winner: true,
        },
        {
          record_no: 2102,
          repz: false,
          user_no: 11,
          is_winner: true,
          vary_rank_rating: 28,
          has_winner: true,
        },
        {
          record_no: 2103,
          repz: false,
          user_no: 11,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
        {
          record_no: 2104,
          repz: false,
          user_no: 11,
          is_winner: true,
          vary_rank_rating: 62,
          has_winner: true,
        },
      ];

      const { proofs } = computeMatchModeProofs({ players, matchRows });

      expect(proofs.get(2104)).toEqual({ mode: "practice", method: "math" });
      expect(proofs.get(2101)).toEqual({ mode: "ranked", method: "math" });
      expect(proofs.get(2102)).toEqual({ mode: "ranked", method: "math" });
      expect(proofs.get(2103)).toEqual({ mode: "ranked", method: "math" });
    });

    test("rejects Practice candidate when contradicted by another ranked participant with <= 0 excess", () => {
      const players = [
        {
          user_no: 20,
          current_ranking: 1,
          win_count: 20,
          lose_count: 5,
          rank_rating: 850,
        },
        {
          user_no: 21,
          current_ranking: 2,
          win_count: 1,
          lose_count: 0,
          rank_rating: null,
        },
        {
          user_no: 22,
          current_ranking: 3,
          win_count: 20,
          lose_count: 5,
          rank_rating: 820,
        },
        // Participant 23 has 0 excess losses (1L in DB, 1L official) -> contradicts match 3002 being Practice!
        {
          user_no: 23,
          current_ranking: 50,
          win_count: 0,
          lose_count: 1,
          rank_rating: 780,
        },
      ];

      const matchRows = [
        {
          record_no: 3001,
          repz: false,
          user_no: 21,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
        {
          record_no: 3002,
          repz: false,
          user_no: 21,
          is_winner: true,
          vary_rank_rating: 65,
          has_winner: true,
        },
        {
          record_no: 3002,
          repz: false,
          user_no: 23,
          is_winner: false,
          vary_rank_rating: -20,
          has_winner: true,
        },
      ];

      const { proofs, stats } = computeMatchModeProofs({ players, matchRows });

      expect(proofs.get(3002)).toBeUndefined();
      expect(proofs.get(3001)).toBeUndefined();
      expect(stats.provenPractice).toBe(0);
      expect(stats.provenRanked).toBe(0);
      expect(stats.rejectedPractice).toBeGreaterThanOrEqual(1);
    });

    test("never marks .repz matches as Practice and propagates multi-player proofs across iterations", () => {
      // Player A (#2, bracket [824, 830], official 1W 0L, starting 801 + 25 = 826):
      //   - Match 4001 (+25, no repz) & Match 4002 (+60, no repz) -> Iteration 1 proves 4001=ranked, 4002=practice!
      // Player B (#4, bracket [820, 824], official 1W 0L, starting 801 + 21 = 822):
      //   - Played 3 wins in DB:
      //     - Match 4000 (+21, repz=true -> always Ranked!)
      //     - Match 4001 (+21, shared with Player A! Without Player A, 4000 vs 4001 both have +21 if repz were false;
      //       here let's test propagation: Player B has official 2W 0L, bracket [840, 845], starting 801+21+21=843!
      //       DB has 3 wins for B: 4001 (+21, proven Ranked by A!), 4003 (+21), 4004 (+21)? No:
      //       Suppose B has 4001 (+35) and 4003 (+35) and 4004 (+21), official 2W 0L, bracket [855, 858] -> 801+35+21=857!
      //       Without knowing 4001 is Ranked, B could exclude EITHER 4001 (+35) OR 4003 (+35)!
      //       Once Iteration 1 proves 4001 is Ranked via Player A, Iteration 2 uniquely proves 4003 is Practice for Player B!)
      const players = [
        {
          user_no: 30,
          current_ranking: 1,
          win_count: 10,
          lose_count: 0,
          rank_rating: 860,
        },
        // Player B (#2): bracket [855, 860], official 2W 0L (801 + 35 + 21 = 857)
        {
          user_no: 31,
          current_ranking: 2,
          win_count: 2,
          lose_count: 0,
          rank_rating: null,
        },
        {
          user_no: 32,
          current_ranking: 3,
          win_count: 10,
          lose_count: 0,
          rank_rating: 855,
        },
        // Player A (#4): bracket [834, 855], official 1W 0L (801 + 35 = 836)
        {
          user_no: 33,
          current_ranking: 4,
          win_count: 1,
          lose_count: 0,
          rank_rating: null,
        },
        {
          user_no: 34,
          current_ranking: 5,
          win_count: 10,
          lose_count: 0,
          rank_rating: 834,
        },
      ];

      const matchRows = [
        // Match 4001: shared win by Player A (+35) and Player B (+35)
        {
          record_no: 4001,
          repz: false,
          user_no: 33,
          is_winner: true,
          vary_rank_rating: 35,
          has_winner: true,
        },
        {
          record_no: 4001,
          repz: false,
          user_no: 31,
          is_winner: true,
          vary_rank_rating: 35,
          has_winner: true,
        },
        // Match 4002: Player A's Practice win (+65) -> A proves 4002=practice & 4001=ranked!
        {
          record_no: 4002,
          repz: false,
          user_no: 33,
          is_winner: true,
          vary_rank_rating: 65,
          has_winner: true,
        },
        // Match 4003: Player B's +35 win -> only unlocked as Practice AFTER 4001 is proven Ranked!
        {
          record_no: 4003,
          repz: false,
          user_no: 31,
          is_winner: true,
          vary_rank_rating: 35,
          has_winner: true,
        },
        // Match 4004: Player B's Ranked win (+21, with .repz)
        {
          record_no: 4004,
          repz: true,
          user_no: 31,
          is_winner: true,
          vary_rank_rating: 21,
          has_winner: true,
        },
      ];

      const { proofs, invalidatedPractice, stats } = computeMatchModeProofs({
        players,
        matchRows,
      });

      expect(proofs.get(4002)).toEqual({ mode: "practice", method: "math" });
      expect(proofs.get(4001)).toEqual({ mode: "ranked", method: "math" });
      expect(proofs.get(4003)).toEqual({ mode: "practice", method: "math" });
      expect(proofs.has(4004)).toBe(false); // .repz is inherently Ranked
      expect(invalidatedPractice.has(4004)).toBe(true);
      expect(stats.provenPractice).toBe(2);
      expect(stats.provenRanked).toBe(1);
      expect(stats.conflicts).toBe(0);
    });

    test("does not falsely mark either match as Practice when two excess candidates have identical PDL", () => {
      const players = [
        {
          user_no: 40,
          current_ranking: 1,
          win_count: 10,
          lose_count: 0,
          rank_rating: 830,
        },
        {
          user_no: 41,
          current_ranking: 2,
          win_count: 1,
          lose_count: 0,
          rank_rating: null,
        },
        {
          user_no: 42,
          current_ranking: 3,
          win_count: 10,
          lose_count: 0,
          rank_rating: 820,
        },
      ];

      const matchRows = [
        {
          record_no: 5001,
          repz: false,
          user_no: 41,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
        {
          record_no: 5002,
          repz: false,
          user_no: 41,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
      ];

      const { proofs, stats } = computeMatchModeProofs({ players, matchRows });

      expect(proofs.size).toBe(0);
      expect(stats.provenPractice).toBe(0);
      expect(stats.provenRanked).toBe(0);
    });

    test("invalidates contradicted Practice proofs when participant excess <= 0 (including excess < 0) while preserving manual overrides", () => {
      const players = [
        // Participant 50 has excess.w = 1 - 2 = -1 (< 0) -> must invalidate stale Practice proof on 6001!
        {
          user_no: 50,
          current_ranking: 10,
          win_count: 2,
          lose_count: 0,
          rank_rating: 850,
        },
        // Participant 51 has excess.w = 1 - 1 = 0, excess.l = 0 - 1 = -1 (missing a loss) -> still invalidates 6002!
        {
          user_no: 51,
          current_ranking: 12,
          win_count: 1,
          lose_count: 1,
          rank_rating: 830,
        },
        // Participant 52 has excess.w = 0 on 6003, which has a manual 'practice' override -> manual override stays protected!
        {
          user_no: 52,
          current_ranking: 15,
          win_count: 1,
          lose_count: 0,
          rank_rating: 810,
        },
      ];

      const matchRows = [
        {
          record_no: 6001,
          repz: false,
          user_no: 50,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
        {
          record_no: 6002,
          repz: false,
          user_no: 51,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
        {
          record_no: 6003,
          repz: false,
          user_no: 52,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
      ];

      const existingProofs = [
        { record_no: 6003, mode: "practice", method: "manual" },
      ];

      const { proofs, invalidatedPractice } = computeMatchModeProofs({
        players,
        matchRows,
        existingProofs,
      });

      expect(invalidatedPractice.has(6001)).toBe(true);
      expect(invalidatedPractice.has(6002)).toBe(true);
      expect(invalidatedPractice.has(6003)).toBe(false);
      expect(proofs.get(6003)).toEqual({ mode: "practice", method: "manual" });
    });

    test("rejects mandatory Practice candidate when every valid subset requires at least one contradicted match", () => {
      // Player 61 (#2, bracket [820, 830], official 1W 0L, DB 3W -> need.w = 2):
      // Candidates: 7001 (+60), 7002 (+25, contradicted by 63), 7003 (+25, contradicted by 64), 7004 (+25, uncontradicted? No: 3W total: 7001 +60, 7002 +25, 7003 +25 -> sum = +110).
      // Valid 2-win exclusions for [820, 830] (801 + 25 = 826): {7001, 7002} and {7001, 7003}.
      // 7001 appears in 100% of valid subsets and is NOT contradicted itself,
      // BUT both 7002 and 7003 ARE contradicted -> 0 uncontradicted valid subsets -> entire batch must be rejected!
      const players = [
        {
          user_no: 60,
          current_ranking: 1,
          win_count: 10,
          lose_count: 0,
          rank_rating: 830,
        },
        {
          user_no: 61,
          current_ranking: 2,
          win_count: 1,
          lose_count: 0,
          rank_rating: null,
        },
        {
          user_no: 62,
          current_ranking: 3,
          win_count: 10,
          lose_count: 0,
          rank_rating: 820,
        },
        {
          user_no: 63,
          current_ranking: 20,
          win_count: 1,
          lose_count: 0,
          rank_rating: 780,
        },
        {
          user_no: 64,
          current_ranking: 21,
          win_count: 1,
          lose_count: 0,
          rank_rating: 775,
        },
      ];

      const matchRows = [
        {
          record_no: 7001,
          repz: false,
          user_no: 61,
          is_winner: true,
          vary_rank_rating: 60,
          has_winner: true,
        },
        {
          record_no: 7002,
          repz: false,
          user_no: 61,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
        {
          record_no: 7002,
          repz: false,
          user_no: 63,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
        {
          record_no: 7003,
          repz: false,
          user_no: 61,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
        {
          record_no: 7003,
          repz: false,
          user_no: 64,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
      ];

      const { proofs, stats } = computeMatchModeProofs({ players, matchRows });

      expect(proofs.size).toBe(0);
      expect(stats.rejectedPractice).toBe(1);
    });

    test("proves Practice via checkpoint_wl_delta for veterans missing early-season history without false contradiction from other missing-history participants", () => {
      const players = [
        // Veteran 70: 100W/50L official, only 1 win in DB (missing 99 historical wins -> season excess.w = -99)
        {
          user_no: 70,
          current_ranking: 5,
          win_count: 100,
          lose_count: 50,
          rank_rating: 2150,
        },
        // Veteran 71: also in match 8010, 80W/40L official, only 1 win in DB (missing 79 historical wins -> season excess.w = -79)
        {
          user_no: 71,
          current_ranking: 12,
          win_count: 80,
          lose_count: 40,
          rank_rating: 2050,
        },
      ];

      const matchRows = [
        {
          record_no: 8010,
          match_date: "2026-11-06T12:10:00.000Z",
          repz: false,
          user_no: 70,
          is_winner: true,
          vary_rank_rating: 18,
          has_winner: true,
        },
        {
          record_no: 8010,
          match_date: "2026-11-06T12:10:00.000Z",
          repz: false,
          user_no: 71,
          is_winner: true,
          vary_rank_rating: 19,
          has_winner: true,
        },
      ];

      const checkpoints = [
        {
          user_no: 70,
          checkpoint_record_no: 8000,
          checkpoint_at: "2026-11-06T12:00:00.000Z",
          win_count: 100,
          lose_count: 50,
          draw_count: 0,
          checkpoint_rating: 2150,
          checkpoint_rating_is_estimated: false,
        },
        {
          user_no: 70,
          checkpoint_record_no: 8010,
          checkpoint_at: "2026-11-06T12:15:00.000Z",
          win_count: 100,
          lose_count: 50,
          draw_count: 0,
          checkpoint_rating: 2150,
          checkpoint_rating_is_estimated: false,
        },
      ];

      const { proofs, invalidatedPractice, stats } = computeMatchModeProofs({
        players,
        matchRows,
        checkpoints,
      });

      expect(proofs.get(8010)).toEqual({
        mode: "practice",
        method: "checkpoint_wl_delta",
      });
      expect(invalidatedPractice.has(8010)).toBe(false);
      expect(stats.provenPractice).toBe(1);
      expect(stats.rejectedPractice).toBe(0);
    });

    test("solves mixed Practice + Ranked windows via checkpoint_math and sanitizes lagged intermediate checkpoints", () => {
      const players = [
        {
          user_no: 80,
          current_ranking: 1,
          win_count: 120,
          lose_count: 40,
          rank_rating: 2180,
        },
        // Veteran 81 (#2, bracket [2170, 2180]): missing 99 early-season wins, played 1 Practice (+18) + 1 Ranked (+26) from 2150 -> 2176
        {
          user_no: 81,
          current_ranking: 2,
          win_count: 101,
          lose_count: 50,
          rank_rating: 2176,
        },
        {
          user_no: 82,
          current_ranking: 3,
          win_count: 110,
          lose_count: 45,
          rank_rating: 2170,
        },
        // Veteran 83: had a cached checkpoint at 9101 (W=50) before GetRankList caught up at 9102 (W=51)
        {
          user_no: 83,
          current_ranking: 20,
          win_count: 51,
          lose_count: 20,
          rank_rating: 1950,
        },
      ];

      const matchRows = [
        {
          record_no: 9001,
          match_date: "2026-11-06T13:05:00.000Z",
          repz: false,
          user_no: 81,
          is_winner: true,
          vary_rank_rating: 18,
          has_winner: true,
        },
        {
          record_no: 9002,
          match_date: "2026-11-06T13:12:00.000Z",
          repz: false,
          user_no: 81,
          is_winner: true,
          vary_rank_rating: 26,
          has_winner: true,
        },
        {
          record_no: 9101,
          match_date: "2026-11-06T14:05:00.000Z",
          repz: false,
          user_no: 83,
          is_winner: true,
          vary_rank_rating: 24,
          has_winner: true,
        },
        {
          record_no: 9102,
          match_date: "2026-11-06T14:12:00.000Z",
          repz: false,
          user_no: 83,
          is_winner: false,
          vary_rank_rating: -15,
          has_winner: true,
        },
      ];

      const checkpoints = [
        {
          user_no: 81,
          checkpoint_record_no: 9000,
          checkpoint_at: "2026-11-06T13:00:00.000Z",
          win_count: 100,
          lose_count: 50,
          draw_count: 0,
          checkpoint_rating: 2150,
          checkpoint_rating_is_estimated: false,
        },
        {
          user_no: 81,
          checkpoint_record_no: 9002,
          checkpoint_at: "2026-11-06T13:15:00.000Z",
          win_count: 101,
          lose_count: 50,
          draw_count: 0,
          checkpoint_rating: 2176,
          checkpoint_rating_is_estimated: false,
        },
        {
          user_no: 83,
          checkpoint_record_no: 9100,
          checkpoint_at: "2026-11-06T14:00:00.000Z",
          win_count: 50,
          lose_count: 20,
          draw_count: 0,
          checkpoint_rating: 1926,
          checkpoint_rating_is_estimated: false,
        },
        // Stale cached snapshot at 9101 (still showing W=50)
        {
          user_no: 83,
          checkpoint_record_no: 9101,
          checkpoint_at: "2026-11-06T14:06:00.000Z",
          win_count: 50,
          lose_count: 20,
          draw_count: 0,
          checkpoint_rating: 1926,
          checkpoint_rating_is_estimated: false,
        },
        // Refreshed snapshot at 9102 (W=51, L=20)
        {
          user_no: 83,
          checkpoint_record_no: 9102,
          checkpoint_at: "2026-11-06T14:15:00.000Z",
          win_count: 51,
          lose_count: 20,
          draw_count: 0,
          checkpoint_rating: 1950,
          checkpoint_rating_is_estimated: false,
        },
      ];

      const { proofs } = computeMatchModeProofs({
        players,
        matchRows,
        checkpoints,
      });

      expect(proofs.get(9001)).toEqual({
        mode: "practice",
        method: "checkpoint_math",
      });
      expect(proofs.get(9002)).toEqual({
        mode: "ranked",
        method: "checkpoint_math",
      });
      expect(proofs.has(9101)).toBe(false);
      expect(proofs.get(9102)).toEqual({
        mode: "practice",
        method: "checkpoint_wl_delta",
      });
    });

    test("preserves valid Practice proofs when neighbors or provers are temporarily unsynchronized alongside missing-history veterans", () => {
      // Scenario A: Veteran 81 (missing 99 wins, season excess = -99) has an enclosing interval (9000, 9002]
      // with rawCounts.w = 2 > d.w = 1, but upper neighbor #1 is temporarily unsynchronized (absent from players).
      // Scenario B: Unseeded prover 90 is temporarily in unsyncedPlayers while sharing match 9501 with
      // missing-history veteran 91 (season excess = -49). Neither persisted Practice proof should be invalidated!
      const players = [
        {
          user_no: 81,
          current_ranking: 2,
          win_count: 101,
          lose_count: 50,
          rank_rating: 2176,
        },
        {
          user_no: 82,
          current_ranking: 3,
          win_count: 110,
          lose_count: 45,
          rank_rating: 2170,
        },
        {
          user_no: 91,
          current_ranking: 15,
          win_count: 50,
          lose_count: 20,
          rank_rating: 1900,
        },
      ];

      const unsyncedPlayers = [
        { user_no: 90, user_nickname: "UnsyncedProver" },
      ];

      const matchRows = [
        {
          record_no: 9001,
          match_date: "2026-11-06T13:05:00.000Z",
          repz: false,
          user_no: 81,
          is_winner: true,
          vary_rank_rating: 18,
          has_winner: true,
        },
        {
          record_no: 9002,
          match_date: "2026-11-06T13:12:00.000Z",
          repz: false,
          user_no: 81,
          is_winner: true,
          vary_rank_rating: 26,
          has_winner: true,
        },
        {
          record_no: 9501,
          match_date: "2026-11-06T15:00:00.000Z",
          repz: false,
          user_no: 90,
          is_winner: true,
          vary_rank_rating: 58,
          has_winner: true,
        },
        {
          record_no: 9501,
          match_date: "2026-11-06T15:00:00.000Z",
          repz: false,
          user_no: 91,
          is_winner: true,
          vary_rank_rating: 20,
          has_winner: true,
        },
      ];

      const checkpoints = [
        {
          user_no: 81,
          checkpoint_record_no: 9000,
          checkpoint_at: "2026-11-06T13:00:00.000Z",
          win_count: 100,
          lose_count: 50,
          draw_count: 0,
          checkpoint_rating: 2150,
          checkpoint_rating_is_estimated: false,
        },
        {
          user_no: 81,
          checkpoint_record_no: 9002,
          checkpoint_at: "2026-11-06T13:15:00.000Z",
          win_count: 101,
          lose_count: 50,
          draw_count: 0,
          checkpoint_rating: 2176,
          checkpoint_rating_is_estimated: false,
        },
      ];

      const existingProofs = [
        { record_no: 9001, mode: "practice", method: "checkpoint_math" },
        { record_no: 9501, mode: "practice", method: "trigger_math" },
      ];

      const { proofs, invalidatedPractice } = computeMatchModeProofs({
        players,
        unsyncedPlayers,
        matchRows,
        existingProofs,
        checkpoints,
      });

      expect(proofs.has(9001)).toBe(false);
      expect(proofs.has(9501)).toBe(false);
      expect(invalidatedPractice.has(9001)).toBe(false);
      expect(invalidatedPractice.has(9501)).toBe(false);
    });

    test("invalidates over-excluded persisted Practice proofs on partial snapshot refresh (0 < dW < raw_w)", () => {
      // Veteran 81 played 2 wins (9001, 9002); cached snapshot at dW=0 marked BOTH as practice.
      // Snapshot refreshed to dW=1 while upper neighbor #1 is unsynchronized so checkpoint_math cannot run yet.
      // Keeping both persisted Practice proofs leaves 0 < 1 non-practice wins -> both must be invalidated!
      const players = [
        {
          user_no: 81,
          current_ranking: 2,
          win_count: 101,
          lose_count: 50,
          rank_rating: 2150,
        },
      ];

      const matchRows = [
        {
          record_no: 9001,
          match_date: "2026-11-06T13:05:00.000Z",
          repz: false,
          user_no: 81,
          is_winner: true,
          vary_rank_rating: 18,
          has_winner: true,
        },
        {
          record_no: 9002,
          match_date: "2026-11-06T13:12:00.000Z",
          repz: false,
          user_no: 81,
          is_winner: true,
          vary_rank_rating: 26,
          has_winner: true,
        },
      ];

      const checkpoints = [
        {
          user_no: 81,
          checkpoint_record_no: 9000,
          checkpoint_at: "2026-11-06T13:00:00.000Z",
          win_count: 100,
          lose_count: 50,
          draw_count: 0,
          checkpoint_rating: 2150,
          checkpoint_rating_is_estimated: false,
        },
        {
          user_no: 81,
          checkpoint_record_no: 9002,
          checkpoint_at: "2026-11-06T13:15:00.000Z",
          win_count: 101,
          lose_count: 50,
          draw_count: 0,
          checkpoint_rating: 2150,
          checkpoint_rating_is_estimated: false,
        },
      ];

      const existingProofs = [
        { record_no: 9001, mode: "practice", method: "checkpoint_wl_delta" },
        { record_no: 9002, mode: "practice", method: "checkpoint_wl_delta" },
      ];

      const { invalidatedPractice } = computeMatchModeProofs({
        players,
        matchRows,
        existingProofs,
        checkpoints,
      });

      expect(invalidatedPractice.has(9001)).toBe(true);
      expect(invalidatedPractice.has(9002)).toBe(true);
    });

    test("resolves inverted adjacent neighbor brackets via monotonic Candidate A / Candidate B", () => {
      // Rank #1425 has 1262, Rank #1427 has stale 1284 (> 1262!), and Rank #1428 has 1239.
      // Player 91 at Rank #1426 has 1 Ranked win (+25 from 1230 -> 1255) and 1 Practice win (+60).
      // bracketOf(91) skips inverted Rank #1427 (1284) and uses monotonic [1239, 1262].
      const players = [
        {
          user_no: 90,
          current_ranking: 1425,
          win_count: 50,
          lose_count: 45,
          rank_rating: 1262,
        },
        {
          user_no: 91,
          current_ranking: 1426,
          win_count: 51,
          lose_count: 48,
          rank_rating: null,
        },
        {
          user_no: 92,
          current_ranking: 1427,
          win_count: 15,
          lose_count: 10,
          rank_rating: 1284,
        },
        {
          user_no: 93,
          current_ranking: 1428,
          win_count: 18,
          lose_count: 14,
          rank_rating: 1239,
        },
      ];

      const matchRows = [
        {
          record_no: 9101,
          repz: false,
          user_no: 91,
          is_winner: true,
          vary_rank_rating: 25,
          has_winner: true,
        },
        {
          record_no: 9102,
          repz: false,
          user_no: 91,
          is_winner: true,
          vary_rank_rating: 60,
          has_winner: true,
        },
      ];

      const checkpoints = [
        {
          user_no: 91,
          checkpoint_record_no: 9100,
          checkpoint_at: "2026-11-06T12:00:00.000Z",
          win_count: 50,
          lose_count: 48,
          draw_count: 0,
          checkpoint_rating: 1230,
          checkpoint_rating_is_estimated: false,
        },
        {
          user_no: 91,
          checkpoint_record_no: 9102,
          checkpoint_at: "2026-11-06T13:00:00.000Z",
          win_count: 51,
          lose_count: 48,
          draw_count: 0,
          checkpoint_rating: null,
          checkpoint_rating_is_estimated: false,
        },
      ];

      const { proofs } = computeMatchModeProofs({
        players,
        matchRows,
        checkpoints,
      });

      expect(proofs.get(9102)).toEqual({
        mode: "practice",
        method: "checkpoint_math",
      });
      expect(proofs.get(9101)).toEqual({
        mode: "ranked",
        method: "checkpoint_math",
      });
    });
  });

  describe("solare.verifyCronBearerToken()", () => {
    test("validates Bearer token against configured secret in constant time", () => {
      const sampleSecret = "unit-test-cron-maintenance-value";

      expect(solare.verifyCronBearerToken(`Bearer ${sampleSecret}`, "")).toBe(
        false,
      );
      expect(solare.verifyCronBearerToken(`Bearer ${sampleSecret}`, null)).toBe(
        false,
      );
      expect(solare.verifyCronBearerToken("", sampleSecret)).toBe(false);
      expect(
        solare.verifyCronBearerToken(`Basic ${sampleSecret}`, sampleSecret),
      ).toBe(false);
      expect(solare.verifyCronBearerToken("Bearer wrong", sampleSecret)).toBe(
        false,
      );
      expect(
        solare.verifyCronBearerToken(`Bearer ${sampleSecret}`, sampleSecret),
      ).toBe(true);
    });
  });
});
