/**
 * Monotonic reconciliation of Solare ratings against Pearl Abyss's official `GetRankList` order.
 *
 * PA hides the real rating and only refreshes `_ranking` once per day (after each region's ranked
 * window closes). Between refreshes our `rank_rating` is computed from match deltas, so it can drift
 * (missed replays, PA-side inactivity decay, practice matches, etc.). Once a player is "synchronized"
 * with the latest official snapshot (no games after their rank was last refreshed), the official order
 * is ground truth: `rating(#1) >= rating(#2) >= ... >= rating(#n)`.
 *
 * A naive top-down clamp (`lower = min(lower, higher)`) is dangerous: a single underestimated player
 * (e.g. `#90 = 1844` between `#89 = 1867` and `#91 = 1867`) would crush every player below them.
 * Instead we keep the Longest Non-Increasing Subsequence (LNIS) of ratings as the trusted backbone and
 * only adjust the minimum number of outliers, interpolating each outlier by rank inside the bracket
 * formed by its nearest trusted LNIS neighbors (`[lowerNeighbor.rating, upperNeighbor.rating]`), or
 * clamping when bounded on only one side.
 *
 * Ties between equally long subsequences prefer keeping higher-ranked players (smaller index), so for
 * `[#1 = 2300, #2 = 2350]` the backbone is `#1` and `#2` is clamped down to `2300`.
 */

/**
 * Returns the indexes (ascending) of a Longest Non-Increasing Subsequence of `values`,
 * preferring earlier elements on ties. O(n^2), which is < 1ms for <= ~1500 ranked rows per region.
 */
export function findLongestNonIncreasingSubsequence(values) {
  const n = values.length;
  if (n === 0) {
    return [];
  }

  const lengths = new Array(n).fill(1);
  const previous = new Array(n).fill(-1);

  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      // Strictly greater length only: keeps the earliest predecessor on ties.
      if (values[j] >= values[i] && lengths[j] + 1 > lengths[i]) {
        lengths[i] = lengths[j] + 1;
        previous[i] = j;
      }
    }
  }

  let bestEnd = 0;
  for (let i = 1; i < n; i += 1) {
    if (lengths[i] > lengths[bestEnd]) {
      bestEnd = i;
    }
  }

  const indexes = [];
  for (let i = bestEnd; i !== -1; i = previous[i]) {
    indexes.push(i);
  }
  return indexes.reverse();
}

/**
 * @param {Array<{ current_ranking: number, rank_rating: number }>} rows
 *   Synchronized players of ONE region/season, with distinct official ranks.
 * @returns {Array<{
 *   row: object,
 *   index: number,
 *   rating: number,
 *   targetRating: number,
 *   upper: object | null,
 *   lower: object | null,
 * }>} Outliers that must be adjusted to restore monotonicity (empty when already consistent).
 */
export function planMonotonicRatingReconciliation(rows) {
  const ordered = [...(rows || [])]
    .filter(
      (r) =>
        r &&
        Number.isFinite(Number(r.current_ranking)) &&
        Number.isFinite(Number(r.rank_rating)),
    )
    .sort((a, b) => Number(a.current_ranking) - Number(b.current_ranking));

  const ratings = ordered.map((r) => Number(r.rank_rating));
  const ranks = ordered.map((r) => Number(r.current_ranking));
  const keptIndexes = findLongestNonIncreasingSubsequence(ratings);
  const kept = new Array(ordered.length).fill(false);
  for (const idx of keptIndexes) {
    kept[idx] = true;
  }

  const nearestUpper = new Array(ordered.length).fill(-1);
  let lastKept = -1;
  for (let i = 0; i < ordered.length; i += 1) {
    nearestUpper[i] = lastKept;
    if (kept[i]) {
      lastKept = i;
    }
  }

  const nearestLower = new Array(ordered.length).fill(-1);
  lastKept = -1;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    nearestLower[i] = lastKept;
    if (kept[i]) {
      lastKept = i;
    }
  }

  const outliers = [];
  for (let i = 0; i < ordered.length; i += 1) {
    if (kept[i]) {
      continue;
    }

    const upperIdx = nearestUpper[i];
    const lowerIdx = nearestLower[i];
    const upperRating = upperIdx >= 0 ? ratings[upperIdx] : null;
    const lowerRating = lowerIdx >= 0 ? ratings[lowerIdx] : null;
    const upperRank = upperIdx >= 0 ? ranks[upperIdx] : null;
    const lowerRank = lowerIdx >= 0 ? ranks[lowerIdx] : null;

    let targetRating = ratings[i];
    if (
      upperRating !== null &&
      lowerRating !== null &&
      lowerRank !== null &&
      upperRank !== null &&
      lowerRank > upperRank
    ) {
      const interpolated = Math.round(
        upperRating -
          ((upperRating - lowerRating) * (ranks[i] - upperRank)) /
            (lowerRank - upperRank),
      );
      targetRating = Math.max(lowerRating, Math.min(upperRating, interpolated));
    } else if (upperRating !== null && targetRating > upperRating) {
      targetRating = upperRating;
    } else if (lowerRating !== null && targetRating < lowerRating) {
      targetRating = lowerRating;
    }

    if (targetRating === ratings[i]) {
      continue;
    }

    outliers.push({
      row: ordered[i],
      index: i,
      rating: ratings[i],
      targetRating,
      upper: upperIdx >= 0 ? ordered[upperIdx] : null,
      lower: lowerIdx >= 0 ? ordered[lowerIdx] : null,
    });
  }

  return outliers;
}
