import database from "~~/infra/database.js";
import { ValidationError } from "~~/infra/errors.js";

const VALID_REGIONS = ["SA", "NA", "EU", "KR", "JP", "RU", "TR", "TW"];
const BASES = [401, 501, 601, 701, 801];
const MAX_ENUM = 300000;
const MAX_ITERATIONS = 10;

function* combos(arr, k, start = 0, acc = []) {
  if (acc.length === k) {
    yield acc.slice();
    return;
  }

  for (let i = start; i <= arr.length - (k - acc.length); i += 1) {
    acc.push(arr[i]);
    yield* combos(arr, k, i + 1, acc);
    acc.pop();
  }
}

function nCk(n, k) {
  if (k < 0 || k > n) {
    return 0;
  }

  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - k + i)) / i;
    if (result > 1e12) {
      return result;
    }
  }
  return result;
}

function parseTimestampMs(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function normalizeRegion(region) {
  if (!region || typeof region !== "string") {
    throw new ValidationError({
      message: `Invalid region: '${region}'.`,
      action: "Valid regions are: SA, NA, EU, KR, JP, RU, TR, TW.",
    });
  }

  const normalized = region.trim().toUpperCase();
  if (!VALID_REGIONS.includes(normalized)) {
    throw new ValidationError({
      message: `Invalid region: '${region}'.`,
      action: "Valid regions are: SA, NA, EU, KR, JP, RU, TR, TW.",
    });
  }

  return normalized;
}

function normalizeSeason(season) {
  if (
    season === undefined ||
    season === null ||
    (typeof season === "string" && season.trim() === "")
  ) {
    return 9;
  }

  const parsed = Number(season);
  if (
    typeof season === "boolean" ||
    Array.isArray(season) ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > 100
  ) {
    throw new ValidationError({
      message: '"season" must be an integer between 1 and 100.',
      action: "Please provide a valid Solare season number.",
    });
  }

  return parsed;
}

/**
 * Pure deterministic solver that proves whether Solare matches are `ranked` or `practice`
 * using official account-wide W/L/D totals, incremental W/L/D checkpoints, and ranking
 * neighbor rating bounds.
 *
 * Rules:
 * - `.repz` matches are always Ranked (`repzRanked`) and can never be marked `practice`.
 * - `wl_exact` (`ranked`): >= 2 ranked participants in the match have exact DB W/L/D == official W/L/D
 *   (either season-wide or within an enclosing synchronized checkpoint window).
 * - `math` (`practice` / `ranked`): for a ranked player with excess games (and 0 missing games),
 *   a match in 100% of valid exclusion subsets whose remaining PDL sum + starting base {401..801}
 *   lands inside [low, up] is `practice` (if uncontradicted), and 0% is `ranked`.
 * - `checkpoint_wl_delta` (`practice`): within an uncontaminated checkpoint interval `(cp_prev, cp_curr]`,
 *   if remaining non-practice matches of an outcome exceed `Δ(official)` and all excess candidates
 *   must be excluded to reach `Δ(official)` (if uncontradicted), they are proven `practice` — even
 *   for veterans missing early-season historical games.
 * - `checkpoint_math` (`practice` / `ranked`): within `(cp_prev, cp_curr]` starting from an exact
 *   `cp_prev.checkpoint_rating`, solves mixed Practice + Ranked intervals against neighbor bounds `[low, up]`.
 */
export function computeMatchModeProofs({
  players = [],
  unsyncedPlayers = [],
  matchRows = [],
  existingProofs = [],
  checkpoints = [],
} = {}) {
  const official = new Map();
  const unsyncedUids = new Set();
  const nickToUid = new Map();

  for (const p of players) {
    const rawUserNo = p.user_no ?? p.uid ?? null;
    const rawNick = p.user_nickname ?? p.nick ?? null;
    const uid =
      rawUserNo !== null && rawUserNo !== undefined
        ? String(rawUserNo)
        : rawNick
          ? `nick:${String(rawNick).trim().toLowerCase()}`
          : null;

    const rk = Number(p.current_ranking ?? p.rk);
    if (!uid || !Number.isInteger(rk) || rk < 1 || official.has(uid)) {
      continue;
    }

    const isEstimated = Boolean(p.rating_is_estimated);
    const rawRating = p.rank_rating ?? p.rating ?? null;
    const exactRating =
      !isEstimated &&
      rawRating !== null &&
      rawRating !== undefined &&
      Number.isFinite(Number(rawRating))
        ? Number(rawRating)
        : null;

    official.set(uid, {
      w: Number(p.win_count ?? p.w ?? 0),
      l: Number(p.lose_count ?? p.l ?? 0),
      d: Number(p.draw_count ?? p.d ?? 0),
      rk,
      rating: exactRating,
      nick: rawNick || null,
    });

    if (rawNick) {
      nickToUid.set(String(rawNick).trim().toLowerCase(), uid);
    }
  }

  for (const up of unsyncedPlayers) {
    const rawUserNo = up?.user_no ?? up?.uid ?? null;
    const rawNick = up?.user_nickname ?? up?.nick ?? null;
    const uid =
      rawUserNo !== null && rawUserNo !== undefined
        ? String(rawUserNo)
        : rawNick
          ? `nick:${String(rawNick).trim().toLowerCase()}`
          : null;

    if (!uid || official.has(uid)) {
      continue;
    }

    unsyncedUids.add(uid);
    if (rawNick) {
      const normalizedNick = String(rawNick).trim().toLowerCase();
      if (!nickToUid.has(normalizedNick)) {
        nickToUid.set(normalizedNick, uid);
      }
    }
  }

  const matches = new Map();
  const byUser = new Map();

  for (const row of matchRows) {
    const rn = Number(row.record_no ?? row.rn);
    if (!Number.isFinite(rn)) {
      continue;
    }

    const rowAt = parseTimestampMs(row.match_date ?? row.at);

    if (!matches.has(rn)) {
      matches.set(rn, {
        rn,
        repz: Boolean(row.repz),
        at: rowAt,
        ps: [],
      });
    } else if (matches.get(rn).at === null && rowAt !== null) {
      matches.get(rn).at = rowAt;
    }

    const hasWinner =
      row.has_winner !== undefined ? Boolean(row.has_winner) : true;
    const out = !hasWinner ? "d" : row.is_winner ? "w" : "l";
    const rawDelta =
      row.vary_rank_rating !== undefined ? row.vary_rank_rating : row.v;
    const v =
      rawDelta === null || rawDelta === undefined ? null : Number(rawDelta);

    const rawUserNo = row.user_no !== undefined ? row.user_no : row.uid;
    const rawNick = row.user_nickname ?? row.nick ?? null;
    const uid =
      rawUserNo !== null && rawUserNo !== undefined
        ? String(rawUserNo)
        : rawNick
          ? nickToUid.get(String(rawNick).trim().toLowerCase()) || null
          : null;

    const effectiveAt = rowAt ?? matches.get(rn).at;
    matches.get(rn).ps.push({ uid, out, v });
    if (uid) {
      if (!byUser.has(uid)) {
        byUser.set(uid, []);
      }
      byUser.get(uid).push({ rn, out, v, at: effectiveAt });
    }
  }

  for (const list of byUser.values()) {
    list.sort((a, b) => a.rn - b.rn);
  }

  const proofs = new Map();
  const repzRanked = new Set();
  const manualPractice = new Set();
  const persistedPractice = new Set();
  let conflicts = 0;

  const setMode = (rn, mode, method) => {
    if (repzRanked.has(rn)) {
      if (mode !== "ranked") {
        conflicts += 1;
      }
      return false;
    }

    const cur = proofs.get(rn);
    if (!cur) {
      proofs.set(rn, { mode, method });
      return true;
    }

    if (cur.mode !== mode) {
      conflicts += 1;
    }
    return false;
  };

  const modeOf = (rn) => (repzRanked.has(rn) ? "ranked" : proofs.get(rn)?.mode);

  for (const m of matches.values()) {
    if (m.repz) {
      repzRanked.add(m.rn);
    }
  }

  for (const ep of existingProofs) {
    const rn = Number(ep?.record_no ?? ep?.rn);
    if (!Number.isFinite(rn) || !matches.has(rn)) {
      continue;
    }
    if (
      ep?.method === "manual" &&
      (ep.mode === "practice" || ep.mode === "ranked")
    ) {
      setMode(rn, ep.mode, "manual");
      if (ep.mode === "practice" && !repzRanked.has(rn)) {
        manualPractice.add(rn);
      }
    } else if (ep?.mode === "practice" && !repzRanked.has(rn)) {
      persistedPractice.add(rn);
    }
  }

  // Build sanitized incremental W/L/D checkpoint intervals per user
  const rawCpByUser = new Map();
  for (const cp of checkpoints) {
    const rawUserNo = cp?.user_no ?? cp?.uid ?? null;
    const cpRn = Number(cp?.checkpoint_record_no ?? cp?.rn);
    if (
      rawUserNo === null ||
      rawUserNo === undefined ||
      !Number.isFinite(cpRn)
    ) {
      continue;
    }

    const uid = String(rawUserNo);
    const isEst = Boolean(cp.checkpoint_rating_is_estimated);
    const rawRating = cp.checkpoint_rating ?? cp.rating ?? null;
    const exactRating =
      !isEst &&
      rawRating !== null &&
      rawRating !== undefined &&
      Number.isFinite(Number(rawRating))
        ? Number(rawRating)
        : null;

    if (!rawCpByUser.has(uid)) {
      rawCpByUser.set(uid, new Map());
    }
    rawCpByUser.get(uid).set(cpRn, {
      rn: cpRn,
      at: parseTimestampMs(cp.checkpoint_at ?? cp.at),
      w: Number(cp.win_count ?? cp.w ?? 0),
      l: Number(cp.lose_count ?? cp.l ?? 0),
      d: Number(cp.draw_count ?? cp.d ?? 0),
      exactRating,
    });
  }

  const countRawInWindow = (userMatches, prevRn, currRn) => {
    const c = { w: 0, l: 0, d: 0 };
    for (const x of userMatches) {
      if (x.rn > prevRn && x.rn <= currRn && !manualPractice.has(x.rn)) {
        c[x.out] += 1;
      }
    }
    return c;
  };

  const intervalsByUser = new Map();
  for (const [uid, cpMap] of rawCpByUser.entries()) {
    const sorted = [...cpMap.values()].sort((a, b) => a.rn - b.rn);
    if (sorted.length < 2) {
      continue;
    }

    const userMatches = byUser.get(uid) || [];

    // Drop intermediate checkpoints whose W/L/D lagged behind a crawled Ranked match
    let idx = 1;
    while (idx < sorted.length - 1) {
      const prev = sorted[idx - 1];
      const mid = sorted[idx];
      const next = sorted[idx + 1];
      const prevRaw = countRawInWindow(userMatches, prev.rn, mid.rn);
      const nextRaw = countRawInWindow(userMatches, mid.rn, next.rn);

      const laggedWin =
        nextRaw.w < next.w - mid.w && prevRaw.w > mid.w - prev.w;
      const laggedLoss =
        nextRaw.l < next.l - mid.l && prevRaw.l > mid.l - prev.l;
      const laggedDraw =
        nextRaw.d < next.d - mid.d && prevRaw.d > mid.d - prev.d;

      if (laggedWin || laggedLoss || laggedDraw) {
        sorted.splice(idx, 1);
        idx = Math.max(1, idx - 1);
      } else {
        idx += 1;
      }
    }

    const validIntervals = [];
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const prev = sorted[i];
      const curr = sorted[i + 1];
      const d = {
        w: curr.w - prev.w,
        l: curr.l - prev.l,
        d: curr.d - prev.d,
      };
      if (d.w < 0 || d.l < 0 || d.d < 0) {
        continue;
      }

      const ms = userMatches.filter((x) => x.rn > prev.rn && x.rn <= curr.rn);
      const hasLatePre =
        prev.at !== null &&
        ms.some((x) => x.at !== null && x.at < prev.at - 2000);
      if (hasLatePre) {
        continue;
      }

      const rawCounts = { w: 0, l: 0, d: 0 };
      for (const x of ms) {
        if (!manualPractice.has(x.rn)) {
          rawCounts[x.out] += 1;
        }
      }

      validIntervals.push({
        uid,
        prevRn: prev.rn,
        currRn: curr.rn,
        d,
        prevExactRating: prev.exactRating,
        ms,
        rawCounts,
      });
    }

    if (validIntervals.length > 0) {
      intervalsByUser.set(uid, validIntervals);
    }
  }

  const enclosingIntervalOf = (uid, rn) => {
    const ivs = intervalsByUser.get(uid);
    if (!ivs) {
      return null;
    }
    for (const iv of ivs) {
      if (rn > iv.prevRn && rn <= iv.currRn) {
        return iv;
      }
    }
    return null;
  };

  const excessCache = new Map();
  const excessOf = (uid) => {
    if (excessCache.has(uid)) {
      return excessCache.get(uid);
    }

    const o = official.get(uid);
    if (!o) {
      return null;
    }

    const counts = { w: 0, l: 0, d: 0 };
    for (const x of byUser.get(uid) || []) {
      counts[x.out] += 1;
    }

    const excess = {
      w: counts.w - o.w,
      l: counts.l - o.l,
      d: counts.d - o.d,
    };
    excessCache.set(uid, excess);
    return excess;
  };

  const remExcessOf = (uid) => {
    const o = official.get(uid);
    if (!o) {
      return null;
    }

    const counts = { w: 0, l: 0, d: 0 };
    for (const x of byUser.get(uid) || []) {
      if (modeOf(x.rn) !== "practice") {
        counts[x.out] += 1;
      }
    }

    return {
      w: counts.w - o.w,
      l: counts.l - o.l,
      d: counts.d - o.d,
    };
  };

  const intervalRemExcessOf = (iv) => {
    const counts = { w: 0, l: 0, d: 0 };
    for (const x of iv.ms) {
      if (modeOf(x.rn) !== "practice") {
        counts[x.out] += 1;
      }
    }
    return {
      w: counts.w - iv.d.w,
      l: counts.l - iv.d.l,
      d: counts.d - iv.d.d,
    };
  };

  const isExactOnMatch = (uid, rn) => {
    const e = excessOf(uid);
    if (Boolean(e) && e.w === 0 && e.l === 0 && e.d === 0) {
      return true;
    }
    const iv = enclosingIntervalOf(uid, rn);
    if (
      iv &&
      iv.d.w + iv.d.l + iv.d.d > 0 &&
      iv.rawCounts.w === iv.d.w &&
      iv.rawCounts.l === iv.d.l &&
      iv.rawCounts.d === iv.d.d
    ) {
      return true;
    }
    return false;
  };

  // A participant contradicts `rn` being Practice ONLY when they have 0 missing Ranked games
  // (either within an enclosing checkpoint interval or season-wide) AND 0 remaining excess for `p.out`.
  // Veterans missing historical early-season games (`re.w < 0 || re.l < 0 || re.d < 0`) do NOT
  // contradict another participant's Practice proof because `practice_db = excess + missing_ranked` can be >= 1.
  const isContradictedForPractice = (rn, selfUid) => {
    const matchObj = matches.get(rn);
    if (!matchObj) {
      return false;
    }

    return matchObj.ps.some((p) => {
      if (!p.uid || p.uid === selfUid) {
        return false;
      }

      const iv = enclosingIntervalOf(p.uid, rn);
      if (iv) {
        const ie = intervalRemExcessOf(iv);
        if (ie.w >= 0 && ie.l >= 0 && ie.d >= 0 && ie[p.out] <= 0) {
          return true;
        }
      }

      const re = remExcessOf(p.uid);
      return (
        Boolean(re) && re.w >= 0 && re.l >= 0 && re.d >= 0 && re[p.out] <= 0
      );
    });
  };

  // 1. Ranked proof via >= 2 exact-W/L/D participants in the same match
  for (const m of matches.values()) {
    if (m.repz) {
      continue;
    }

    const exactUids = new Set();
    for (const p of m.ps) {
      if (p.uid && isExactOnMatch(p.uid, m.rn)) {
        exactUids.add(p.uid);
      }
    }
    if (exactUids.size >= 2) {
      setMode(m.rn, "ranked", "wl_exact");
    }
  }

  // 2. Non-estimated rated neighbors ordered by official ranking
  const freshSorted = [...official.entries()]
    .map(([uid, o]) => ({ uid, rk: o.rk, rating: o.rating }))
    .filter((f) => f.rating !== null)
    .sort((a, b) => a.rk - b.rk);

  const bracketOf = (uid) => {
    const entry = official.get(uid);
    if (!entry) {
      return { up: null, low: null };
    }
    const rk = entry.rk;
    let upA = null;
    let lowB = null;

    for (const f of freshSorted) {
      if (f.uid === uid) {
        continue;
      }
      if (f.rk < rk) {
        upA = f;
      } else if (f.rk > rk) {
        lowB = f;
        break;
      }
    }

    if (rk === 1) {
      return { up: 99999, low: lowB ? lowB.rating : null };
    }

    if (!upA || !lowB || upA.rating >= lowB.rating) {
      return {
        up: upA ? upA.rating : null,
        low: lowB ? lowB.rating : null,
      };
    }

    // Resolve inverted immediate neighbors (upA.rating < lowB.rating) via monotonic Candidate A vs Candidate B
    let lowA = null;
    for (const f of freshSorted) {
      if (f.uid !== uid && f.rk > lowB.rk && f.rating <= upA.rating) {
        lowA = f;
        break;
      }
    }

    let upB = null;
    for (const f of freshSorted) {
      if (f.uid !== uid && f.rk < upA.rk && f.rating >= lowB.rating) {
        upB = f;
      }
    }

    if (lowA && upB) {
      const gapA = upA.rating - lowA.rating;
      const gapB = upB.rating - lowB.rating;
      const tightA = gapA <= 40;
      const tightB = gapB <= 40;
      const spanA = lowA.rk - upA.rk;
      const spanB = lowB.rk - upB.rk;

      const preferA =
        (tightA && !tightB) ||
        (tightA === tightB && spanA < spanB) ||
        (tightA === tightB && spanA === spanB && gapA <= gapB);

      return preferA
        ? { up: upA.rating, low: lowA.rating }
        : { up: upB.rating, low: lowB.rating };
    }

    if (lowA) {
      return { up: upA.rating, low: lowA.rating };
    }
    if (upB) {
      return { up: upB.rating, low: lowB.rating };
    }

    return { up: upA.rating, low: lowB.rating };
  };

  const solveSubset = ({ uid, cand, need, baseDeltaSum, bases, low, up }) => {
    const totalCombos =
      nCk(cand.w.length, need.w) *
      nCk(cand.l.length, need.l) *
      nCk(cand.d.length, need.d);
    if (totalCombos === 0) {
      return { status: "no_candidates" };
    }
    if (totalCombos > MAX_ENUM) {
      return { status: "too_many" };
    }

    const allCands = [...cand.w, ...cand.l, ...cand.d];
    const contradictedRns = new Set(
      allCands
        .filter((x) => isContradictedForPractice(x.rn, uid))
        .map((x) => x.rn),
    );

    const inCount = new Map(allCands.map((x) => [x.rn, 0]));
    let valid = 0;
    let validUncontradicted = 0;

    for (const cw of combos(cand.w, need.w)) {
      const sw = cw.reduce((s, x) => s + x.v, 0);
      const contraW = cw.some((x) => contradictedRns.has(x.rn));
      for (const cl of combos(cand.l, need.l)) {
        const sl = cl.reduce((s, x) => s + x.v, 0);
        const contraWL = contraW || cl.some((x) => contradictedRns.has(x.rn));
        for (const cd of combos(cand.d, need.d)) {
          const sd = cd.reduce((s, x) => s + x.v, 0);
          const remainingDelta = baseDeltaSum - sw - sl - sd;
          const fits = bases.some((b) => {
            const candidateRating = Math.max(0, b + remainingDelta);
            return candidateRating >= low && candidateRating <= up;
          });

          if (!fits) {
            continue;
          }

          valid += 1;
          if (!contraWL && !cd.some((x) => contradictedRns.has(x.rn))) {
            validUncontradicted += 1;
          }
          for (const x of cw) {
            inCount.set(x.rn, inCount.get(x.rn) + 1);
          }
          for (const x of cl) {
            inCount.set(x.rn, inCount.get(x.rn) + 1);
          }
          for (const x of cd) {
            inCount.set(x.rn, inCount.get(x.rn) + 1);
          }
        }
      }
    }

    if (valid === 0) {
      return { status: "no_solution" };
    }
    if (validUncontradicted === 0) {
      return { status: "contradicted" };
    }

    const practice = [];
    const ranked = [];
    for (const [rn, count] of inCount) {
      if (count === valid) {
        practice.push(rn);
      } else if (count === 0) {
        ranked.push(rn);
      }
    }

    if (practice.some((rn) => contradictedRns.has(rn))) {
      return { status: "contradicted" };
    }

    return { status: "solved", practice, ranked };
  };

  const solvePlayer = (uid) => {
    const ex = excessOf(uid);
    if (!ex || ex.w < 0 || ex.l < 0 || ex.d < 0) {
      return { status: "missing_games" };
    }

    const ms = byUser.get(uid);
    if (!ms || ms.some((x) => x.v === null || Number.isNaN(x.v))) {
      return { status: "null_pdl" };
    }

    const need = { ...ex };
    let baseDeltaSum = 0;
    const cand = { w: [], l: [], d: [] };

    for (const x of ms) {
      const md = modeOf(x.rn);
      if (md === "practice") {
        need[x.out] -= 1;
        continue;
      }

      baseDeltaSum += x.v;
      if (md !== "ranked") {
        cand[x.out].push(x);
      }
    }

    if (need.w < 0 || need.l < 0 || need.d < 0) {
      return { status: "inconsistent" };
    }
    if (need.w + need.l + need.d === 0) {
      return { status: "no_excess" };
    }

    const { up, low } = bracketOf(uid);
    if (up === null || low === null || up < low) {
      return { status: "no_bracket" };
    }

    return solveSubset({
      uid,
      cand,
      need,
      baseDeltaSum,
      bases: BASES,
      low,
      up,
    });
  };

  // 3. Fixed-point propagation across season-wide players and incremental checkpoints
  let rejectedPractice = 0;
  const statusCount = {};

  for (let iter = 1; iter <= MAX_ITERATIONS; iter += 1) {
    let changed = 0;
    for (const k of Object.keys(statusCount)) {
      delete statusCount[k];
    }

    for (const uid of official.keys()) {
      if (!byUser.has(uid)) {
        continue;
      }

      const solved = solvePlayer(uid);
      statusCount[solved.status] = (statusCount[solved.status] || 0) + 1;
      if (solved.status === "contradicted") {
        rejectedPractice += 1;
        continue;
      }
      if (solved.status !== "solved") {
        continue;
      }

      for (const rn of solved.practice) {
        if (setMode(rn, "practice", "math")) {
          changed += 1;
        }
      }

      for (const rn of solved.ranked) {
        if (setMode(rn, "ranked", "math")) {
          changed += 1;
        }
      }
    }

    for (const ivs of intervalsByUser.values()) {
      for (const iv of ivs) {
        if (iv.ms.length === 0) {
          continue;
        }

        const nonPrac = { w: 0, l: 0, d: 0 };
        const cand = { w: [], l: [], d: [] };
        let baseDeltaSum = 0;
        let hasNullPdl = false;

        for (const x of iv.ms) {
          const md = modeOf(x.rn);
          if (md === "practice") {
            continue;
          }
          nonPrac[x.out] += 1;
          if (x.v === null || Number.isNaN(x.v)) {
            hasNullPdl = true;
          } else {
            baseDeltaSum += x.v;
          }
          if (md !== "ranked") {
            cand[x.out].push(x);
          }
        }

        const need = {
          w: nonPrac.w - iv.d.w,
          l: nonPrac.l - iv.d.l,
          d: nonPrac.d - iv.d.d,
        };

        // 3a. Direct outcome pigeonhole proof (`checkpoint_wl_delta`)
        for (const out of ["w", "l", "d"]) {
          if (
            iv.d[out] >= 0 &&
            need[out] > 0 &&
            cand[out].length === need[out]
          ) {
            const hasContra = cand[out].some((x) =>
              isContradictedForPractice(x.rn, iv.uid),
            );
            if (hasContra) {
              rejectedPractice += 1;
              continue;
            }
            for (const x of cand[out]) {
              if (setMode(x.rn, "practice", "checkpoint_wl_delta")) {
                changed += 1;
              }
              need[out] -= 1;
              if (x.v !== null && !Number.isNaN(x.v)) {
                baseDeltaSum -= x.v;
              }
            }
            cand[out] = [];
          }
        }

        // 3b. Combinatorial checkpoint rating proof (`checkpoint_math`)
        if (
          need.w >= 0 &&
          need.l >= 0 &&
          need.d >= 0 &&
          need.w + need.l + need.d > 0 &&
          !hasNullPdl &&
          iv.prevExactRating !== null &&
          official.has(iv.uid)
        ) {
          const hasPostCurrMatch = (byUser.get(iv.uid) || []).some(
            (x) => x.rn > iv.currRn && modeOf(x.rn) !== "practice",
          );
          if (!hasPostCurrMatch) {
            const { up, low } = bracketOf(iv.uid);
            if (up !== null && low !== null && up >= low) {
              const cpSolved = solveSubset({
                uid: iv.uid,
                cand,
                need,
                baseDeltaSum,
                bases: [iv.prevExactRating],
                low,
                up,
              });
              if (cpSolved.status === "contradicted") {
                rejectedPractice += 1;
              } else if (cpSolved.status === "solved") {
                for (const rn of cpSolved.practice) {
                  if (setMode(rn, "practice", "checkpoint_math")) {
                    changed += 1;
                  }
                }
                for (const rn of cpSolved.ranked) {
                  if (setMode(rn, "ranked", "checkpoint_math")) {
                    changed += 1;
                  }
                }
              }
            }
          }
        }
      }
    }

    if (!changed) {
      break;
    }
  }

  const isEffectivePersistedPractice = (rn) => {
    const activeMode = modeOf(rn);
    if (activeMode === "practice") {
      return true;
    }
    if (activeMode === "ranked") {
      return false;
    }
    return persistedPractice.has(rn);
  };

  // Matches without an active Practice proof that must invalidate any stale persisted Practice proof
  const invalidatedPractice = new Set(repzRanked);
  for (const m of matches.values()) {
    if (proofs.get(m.rn)?.mode === "practice") {
      continue;
    }

    // 1. Hard contradiction by a participant with complete counts (in enclosing checkpoint or season-wide)
    const isHardContradicted = m.ps.some((p) => {
      if (!p.uid) {
        return false;
      }
      const iv = enclosingIntervalOf(p.uid, m.rn);
      if (iv) {
        return intervalRemExcessOf(iv)[p.out] <= 0;
      }
      const e = excessOf(p.uid);
      if (!e || e.w < 0 || e.l < 0 || e.d < 0) {
        return false;
      }
      const re = remExcessOf(p.uid);
      return Boolean(re) && re[p.out] <= 0;
    });

    if (isHardContradicted) {
      invalidatedPractice.add(m.rn);
      continue;
    }

    // 2. Partial snapshot refresh over-exclusion: keeping persisted Practice proofs leaves < official Ranked count
    if (persistedPractice.has(m.rn)) {
      const isOverExcluded = m.ps.some((p) => {
        if (!p.uid) {
          return false;
        }
        const iv = enclosingIntervalOf(p.uid, m.rn);
        if (iv) {
          let nonPracCount = 0;
          for (const x of iv.ms) {
            if (x.out === p.out && !isEffectivePersistedPractice(x.rn)) {
              nonPracCount += 1;
            }
          }
          return nonPracCount < iv.d[p.out];
        }
        const e = excessOf(p.uid);
        const o = official.get(p.uid);
        if (!e || !o || e.w < 0 || e.l < 0 || e.d < 0) {
          return false;
        }
        let nonPracSeason = 0;
        for (const x of byUser.get(p.uid) || []) {
          if (x.out === p.out && !isEffectivePersistedPractice(x.rn)) {
            nonPracSeason += 1;
          }
        }
        return nonPracSeason < o[p.out];
      });

      if (isOverExcluded) {
        invalidatedPractice.add(m.rn);
        continue;
      }
    }

    // 3. Orphaned stale proof: at least one participant has <= 0 excess and NO participant can act as an excess prover
    const hasNonPositiveParticipant = m.ps.some((p) => {
      if (!p.uid) {
        return false;
      }
      const iv = enclosingIntervalOf(p.uid, m.rn);
      if (iv) {
        return intervalRemExcessOf(iv)[p.out] <= 0;
      }
      const re = remExcessOf(p.uid);
      return Boolean(re) && re[p.out] <= 0;
    });

    if (hasNonPositiveParticipant) {
      const hasPotentialProver = m.ps.some((p) => {
        if (!p.uid) {
          return false;
        }
        const iv = enclosingIntervalOf(p.uid, m.rn);
        if (iv) {
          return intervalRemExcessOf(iv)[p.out] > 0;
        }
        if (unsyncedUids.has(p.uid)) {
          return true;
        }
        const re = remExcessOf(p.uid);
        return Boolean(re) && re[p.out] > 0;
      });

      if (!hasPotentialProver) {
        invalidatedPractice.add(m.rn);
      }
    }
  }

  let practiceCount = 0;
  let rankedCount = 0;
  for (const p of proofs.values()) {
    if (p.mode === "practice") {
      practiceCount += 1;
    } else {
      rankedCount += 1;
    }
  }

  return {
    proofs,
    invalidatedPractice,
    stats: {
      officialUsers: official.size,
      matches: matches.size,
      provenRanked: rankedCount,
      provenPractice: practiceCount,
      conflicts,
      rejectedPractice,
      players: statusCount,
    },
  };
}

/**
 * Pure-PostgreSQL region proof runner (0 external HTTP calls).
 * Reads synchronized ranked players, incremental W/L/D checkpoints, and season matches,
 * computes mathematical proofs, persists `solare_match_mode_proofs`, and refreshes
 * `solare_practice_suspect_matches`.
 */
export async function proveRegionMatchModes({ region, season } = {}) {
  const targetRegion = normalizeRegion(region);
  const targetSeason = normalizeSeason(season);

  const playersResult = await database.query({
    text: `
      WITH latest_by_rank AS (
        SELECT DISTINCT ON (sp.current_ranking)
          sp.user_no,
          sp.user_nickname,
          sp.current_ranking,
          sp.win_count,
          sp.lose_count,
          sp.draw_count,
          sp.rank_rating,
          sp.rating_is_estimated,
          sp.last_seen_at
        FROM solare_players sp
        WHERE sp.region = $1
          AND sp.current_ranking IS NOT NULL
          AND sp.current_ranking >= 1
          AND (
            sp.season = $2
            OR ($2 = 9 AND sp.season IS NULL)
          )
        ORDER BY
          sp.current_ranking ASC,
          sp.last_seen_at DESC NULLS LAST,
          sp.updated_at DESC NULLS LAST
      )
      SELECT
        l.user_no,
        l.user_nickname,
        l.current_ranking,
        l.win_count,
        l.lose_count,
        l.draw_count,
        l.rank_rating,
        l.rating_is_estimated,
        (
          l.last_seen_at IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM solare_match_players mp
            INNER JOIN solare_matches m
              ON m.region = mp.region AND m.record_no = mp.record_no
            LEFT JOIN solare_match_mode_proofs pr
              ON pr.region = mp.region AND pr.record_no = mp.record_no
            WHERE mp.region = $1
              AND COALESCE(pr.mode, '') <> 'practice'
              AND (
                m.season = $2
                OR ($2 = 9 AND m.season IS NULL)
              )
              AND (
                (l.user_no IS NOT NULL AND mp.user_no = l.user_no)
                OR ((l.user_no IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER(l.user_nickname))
              )
              AND m.match_date IS NOT NULL
              AND m.match_date > l.last_seen_at + INTERVAL '10 seconds'
          )
        ) AS is_synced
      FROM latest_by_rank l
      ORDER BY l.current_ranking ASC
      ;`,
    values: [targetRegion, targetSeason],
  });

  const matchesResult = await database.query({
    text: `
      SELECT
        m.record_no::bigint AS record_no,
        m.match_date,
        NULLIF(TRIM(m.repz_download_url), '') IS NOT NULL AS repz,
        mp.user_no,
        mp.user_nickname,
        mp.is_winner,
        mp.vary_rank_rating,
        BOOL_OR(mp.is_winner) OVER (PARTITION BY m.record_no) AS has_winner
      FROM solare_matches m
      INNER JOIN solare_match_players mp
        ON mp.region = m.region AND mp.record_no = m.record_no
      WHERE m.region = $1
        AND (
          m.season = $2
          OR ($2 = 9 AND m.season IS NULL)
        )
      ;`,
    values: [targetRegion, targetSeason],
  });

  const existingProofsResult = await database.query({
    text: `
      SELECT
        record_no::bigint AS record_no,
        mode,
        method
      FROM solare_match_mode_proofs
      WHERE region = $1
      ;`,
    values: [targetRegion],
  });

  const checkpointsResult = await database.query({
    text: `
      SELECT
        user_no,
        checkpoint_record_no::bigint AS checkpoint_record_no,
        checkpoint_at,
        win_count,
        lose_count,
        draw_count,
        checkpoint_rating,
        checkpoint_rating_is_estimated
      FROM solare_player_wl_checkpoints
      WHERE region = $1
        AND (
          season = $2
          OR ($2 = 9 AND season IS NULL)
        )
      ORDER BY user_no ASC, checkpoint_record_no ASC
      ;`,
    values: [targetRegion, targetSeason],
  });

  const syncedPlayers = [];
  const unsyncedPlayers = [];
  for (const row of playersResult.rows) {
    if (row.is_synced) {
      syncedPlayers.push(row);
    } else {
      unsyncedPlayers.push(row);
    }
  }

  const { proofs, invalidatedPractice, stats } = computeMatchModeProofs({
    players: syncedPlayers,
    unsyncedPlayers,
    matchRows: matchesResult.rows,
    existingProofs: existingProofsResult.rows,
    checkpoints: checkpointsResult.rows,
  });

  const entries = [...proofs.entries()].filter(
    ([, p]) => p.method !== "manual",
  );
  const recordNos = entries.map(([rn]) => rn);
  const modes = entries.map(([, p]) => p.mode);
  const methods = entries.map(([, p]) => p.method);
  const invalidatedRns = [...invalidatedPractice];

  const persistResult = await database.query({
    text: `
      WITH incoming_proofs AS (
        SELECT
          u.rn,
          u.mode,
          u.method
        FROM unnest($2::bigint[], $3::varchar[], $4::varchar[]) AS u(rn, mode, method)
      ),
      deleted_invalid AS (
        DELETE FROM solare_match_mode_proofs p
        WHERE p.region = $1
          AND p.method <> 'manual'
          AND (
            NOT EXISTS (
              SELECT 1
              FROM solare_matches m
              WHERE m.region = p.region
                AND m.record_no = p.record_no
            )
            OR (
              p.mode = 'practice'
              AND p.record_no = ANY($5::bigint[])
              AND NOT EXISTS (
                SELECT 1
                FROM incoming_proofs ip
                WHERE ip.rn = p.record_no
              )
            )
          )
        RETURNING p.record_no
      ),
      upserted AS (
        INSERT INTO solare_match_mode_proofs (region, record_no, mode, method)
        SELECT
          $1,
          ip.rn,
          ip.mode,
          ip.method
        FROM incoming_proofs ip
        ON CONFLICT (region, record_no) DO UPDATE
        SET
          mode = EXCLUDED.mode,
          method = EXCLUDED.method,
          created_at = timezone('utc', now())
        WHERE
          solare_match_mode_proofs.method <> 'manual'
          AND (
            solare_match_mode_proofs.mode IS DISTINCT FROM EXCLUDED.mode
            OR solare_match_mode_proofs.method IS DISTINCT FROM EXCLUDED.method
          )
        RETURNING record_no
      )
      SELECT
        (SELECT COUNT(*)::int FROM upserted) AS upserted_count,
        (SELECT COUNT(*)::int FROM deleted_invalid) AS deleted_count
      ;`,
    values: [targetRegion, recordNos, modes, methods, invalidatedRns],
  });

  const refreshResult = await database.query({
    text: `SELECT fn_refresh_solare_practice_suspects($1, 0, FALSE) AS refreshed_count;`,
    values: [targetRegion],
  });

  return {
    region: targetRegion,
    season: targetSeason,
    upsertedCount: Number(persistResult.rows[0]?.upserted_count || 0),
    deletedCount: Number(persistResult.rows[0]?.deleted_count || 0),
    refreshedSuspectsCount: Number(refreshResult.rows[0]?.refreshed_count || 0),
    ...stats,
  };
}

const solareMatchModeProof = {
  computeMatchModeProofs,
  proveRegionMatchModes,
};

export default solareMatchModeProof;
