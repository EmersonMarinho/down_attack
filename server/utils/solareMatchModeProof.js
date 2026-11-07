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
 * using official account-wide W/L/D totals and ranking neighbor rating bounds.
 *
 * Rules:
 * - `.repz` matches are always Ranked (`repzRanked`) and can never be marked `practice`.
 * - `wl_exact` (`ranked`): >= 2 ranked participants in the match have exact DB W/L/D == official W/L/D.
 *   (A single exact participant is insufficient because 1 Practice game + 1 missing Ranked game cancel.)
 * - `math` (`practice`): for a ranked player with excess games (and 0 missing games), the match appears
 *   in 100% of valid exclusion subsets whose remaining PDL sum + starting base {401..801} lands inside
 *   the player's non-estimated neighbor rating bracket [low, up], AND no other ranked participant in
 *   that match contradicts it (`excess[outcome] <= 0`).
 * - `math` (`ranked`): for a ranked player with excess games, the match appears in 0% of valid exclusion subsets.
 */
export function computeMatchModeProofs({
  players = [],
  matchRows = [],
  existingProofs = [],
} = {}) {
  const official = new Map();
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

  const matches = new Map();
  const byUser = new Map();

  for (const row of matchRows) {
    const rn = Number(row.record_no ?? row.rn);
    if (!Number.isFinite(rn)) {
      continue;
    }

    if (!matches.has(rn)) {
      matches.set(rn, {
        rn,
        repz: Boolean(row.repz),
        ps: [],
      });
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

    matches.get(rn).ps.push({ uid, out, v });
    if (uid) {
      if (!byUser.has(uid)) {
        byUser.set(uid, []);
      }
      byUser.get(uid).push({ rn, out, v });
    }
  }

  const proofs = new Map();
  const repzRanked = new Set();
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
    }
  }

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

  const isExact = (uid) => {
    const e = excessOf(uid);
    return Boolean(e) && e.w === 0 && e.l === 0 && e.d === 0;
  };

  // 1. Ranked proof via >= 2 exact-W/L/D participants in the same match
  for (const m of matches.values()) {
    if (m.repz) {
      continue;
    }

    const exactCount = m.ps.filter((p) => p.uid && isExact(p.uid)).length;
    if (exactCount >= 2) {
      setMode(m.rn, "ranked", "wl_exact");
    }
  }

  // 2. Non-estimated rated neighbors ordered by official ranking
  const freshSorted = [...official.entries()]
    .map(([uid, o]) => ({ uid, rk: o.rk, rating: o.rating }))
    .filter((f) => f.rating !== null)
    .sort((a, b) => a.rk - b.rk);

  const bracketOf = (uid) => {
    const rk = official.get(uid).rk;
    let up = rk === 1 ? 99999 : null;
    let low = null;

    for (const f of freshSorted) {
      if (f.uid === uid) {
        continue;
      }
      if (f.rk < rk) {
        up = f.rating;
      } else if (f.rk > rk) {
        low = f.rating;
        break;
      }
    }

    return { up, low };
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
        .filter((x) =>
          matches.get(x.rn).ps.some((p) => {
            if (!p.uid || p.uid === uid) {
              return false;
            }
            const e = excessOf(p.uid);
            return Boolean(e) && e[p.out] <= 0;
          }),
        )
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
          const fits = BASES.some((b) => {
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

    return { status: "solved", practice, ranked };
  };

  // 3. Fixed-point propagation across all ranked players
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

      const hasContradictedPractice = solved.practice.some((rn) =>
        matches.get(rn).ps.some((p) => {
          if (!p.uid || p.uid === uid) {
            return false;
          }
          const e = excessOf(p.uid);
          return Boolean(e) && e[p.out] <= 0;
        }),
      );

      if (hasContradictedPractice) {
        rejectedPractice += 1;
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

    if (!changed) {
      break;
    }
  }

  // Matches that cannot be Practice (has .repz, or a synchronized participant has excess[outcome] <= 0)
  const invalidatedPractice = new Set(repzRanked);
  for (const m of matches.values()) {
    if (proofs.get(m.rn)?.mode === "practice") {
      continue;
    }
    const isContradictedByParticipant = m.ps.some((p) => {
      if (!p.uid) {
        return false;
      }
      const e = excessOf(p.uid);
      return Boolean(e) && e[p.out] <= 0;
    });
    if (isContradictedByParticipant) {
      invalidatedPractice.add(m.rn);
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
 * Reads synchronized ranked players + season matches, computes mathematical proofs,
 * persists `solare_match_mode_proofs`, and refreshes `solare_practice_suspect_matches`.
 */
export async function proveRegionMatchModes({ region, season } = {}) {
  const targetRegion = normalizeRegion(region);
  const targetSeason = normalizeSeason(season);

  const [playersResult, matchesResult, manualProofsResult] = await Promise.all([
    database.query({
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
          l.rating_is_estimated
        FROM latest_by_rank l
        WHERE
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
        ORDER BY l.current_ranking ASC
        ;`,
      values: [targetRegion, targetSeason],
    }),
    database.query({
      text: `
        SELECT
          m.record_no::bigint AS record_no,
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
    }),
    database.query({
      text: `
        SELECT
          record_no::bigint AS record_no,
          mode,
          method
        FROM solare_match_mode_proofs
        WHERE region = $1
          AND method = 'manual'
        ;`,
      values: [targetRegion],
    }),
  ]);

  const { proofs, invalidatedPractice, stats } = computeMatchModeProofs({
    players: playersResult.rows,
    matchRows: matchesResult.rows,
    existingProofs: manualProofsResult.rows,
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
    text: `SELECT fn_refresh_solare_practice_suspects($1, 0) AS refreshed_count;`,
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
