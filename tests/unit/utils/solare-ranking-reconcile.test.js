import {
  findLongestNonIncreasingSubsequence,
  planMonotonicRatingReconciliation,
} from "~~/server/utils/solareRankingReconcile.js";

describe("server/utils/solareRankingReconcile.js", () => {
  test("returns empty plan when ratings are already monotonically non-increasing", () => {
    const rows = [
      { user_nickname: "Rank1", current_ranking: 1, rank_rating: 2455 },
      { user_nickname: "Rank2", current_ranking: 2, rank_rating: 2290 },
      { user_nickname: "Rank3", current_ranking: 3, rank_rating: 2290 },
      { user_nickname: "Rank4", current_ranking: 4, rank_rating: 2228 },
    ];

    expect(
      findLongestNonIncreasingSubsequence([2455, 2290, 2290, 2228]),
    ).toEqual([0, 1, 2, 3]);
    expect(planMonotonicRatingReconciliation(rows)).toEqual([]);
  });

  test("clamps Rank #2 down to Rank #1 in a 2-player post-decay inversion", () => {
    const rows = [
      { user_nickname: "NaS10Decay1", current_ranking: 1, rank_rating: 2300 },
      { user_nickname: "NaS10Rank2", current_ranking: 2, rank_rating: 2350 },
    ];

    const plan = planMonotonicRatingReconciliation(rows);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      index: 1,
      rating: 2350,
      targetRating: 2300,
    });
    expect(plan[0].row.user_nickname).toBe("NaS10Rank2");
  });

  test("lifts a single underestimated player (#90 Ahai = 1844 between 1867 and 1867) without domino-crushing lower ranks", () => {
    const rows = [
      { user_nickname: "IlumiRHLM", current_ranking: 88, rank_rating: 1869 },
      { user_nickname: "Jekins", current_ranking: 89, rank_rating: 1867 },
      { user_nickname: "Ahai", current_ranking: 90, rank_rating: 1844 },
      {
        user_nickname: "TwitchCrowleyTV",
        current_ranking: 91,
        rank_rating: 1867,
      },
      { user_nickname: "MikaMika", current_ranking: 92, rank_rating: 1866 },
      { user_nickname: "Fenan", current_ranking: 93, rank_rating: 1866 },
    ];

    const plan = planMonotonicRatingReconciliation(rows);
    expect(plan).toHaveLength(1);
    expect(plan[0].row.user_nickname).toBe("Ahai");
    expect(plan[0].rating).toBe(1844);
    expect(plan[0].targetRating).toBe(1867);
  });

  test("interpolates overestimated and decayed outliers (#18 Bonelli, #25 MENORQUENTE, #26 Okazaki) into neighbor brackets", () => {
    const rows = [
      { user_nickname: "Syorin", current_ranking: 16, rank_rating: 2115 },
      { user_nickname: "King999", current_ranking: 17, rank_rating: 2111 },
      { user_nickname: "Bonelli", current_ranking: 18, rank_rating: 2151 },
      { user_nickname: "Raviolete7", current_ranking: 19, rank_rating: 2110 },
      { user_nickname: "Pancadaz", current_ranking: 20, rank_rating: 2104 },
      { user_nickname: "BlackBills", current_ranking: 24, rank_rating: 2075 },
      { user_nickname: "MENORQUENTE", current_ranking: 25, rank_rating: 2113 },
      { user_nickname: "Okazaki", current_ranking: 26, rank_rating: 2149 },
      { user_nickname: "Neri", current_ranking: 27, rank_rating: 2066 },
      { user_nickname: "Kuwuja", current_ranking: 28, rank_rating: 2054 },
    ];

    const plan = planMonotonicRatingReconciliation(rows);
    expect(
      plan.map((p) => ({
        nick: p.row.user_nickname,
        from: p.rating,
        to: p.targetRating,
      })),
    ).toEqual([
      { nick: "Bonelli", from: 2151, to: 2111 },
      { nick: "MENORQUENTE", from: 2113, to: 2072 },
      { nick: "Okazaki", from: 2149, to: 2069 },
    ]);

    // Applying the plan produces a strictly non-increasing rating sequence
    const updated = rows.map((r) => {
      const hit = plan.find((p) => p.row.user_nickname === r.user_nickname);
      return hit ? hit.targetRating : r.rank_rating;
    });
    for (let i = 0; i < updated.length - 1; i += 1) {
      expect(updated[i]).toBeGreaterThanOrEqual(updated[i + 1]);
    }
  });
});
