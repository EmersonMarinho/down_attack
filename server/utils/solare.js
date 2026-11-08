import crypto from "node:crypto";
import database from "~~/infra/database.js";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from "~~/infra/errors.js";
import {
  getClassName,
  getSkillBranch,
  getTierInfo,
} from "~~/app/utils/solareTier.js";
import {
  computeMatchModeProofs,
  proveRegionMatchModes,
} from "~~/server/utils/solareMatchModeProof.js";
import { planMonotonicRatingReconciliation } from "~~/server/utils/solareRankingReconcile.js";

const VALID_REGIONS = ["SA", "NA", "EU", "KR", "JP", "RU", "TR", "TW"];
const SOLARE_SHARED_RANK_FLOOR = 999;

const REGION_BY_COUNTRIES = {
  KR: ["KR"],
  JP: ["JP"],
  TW: ["TW", "HK", "MO"],
  TR: [
    "TR",
    "AE",
    "EG",
    "IL",
    "QA",
    "KW",
    "BH",
    "OM",
    "JO",
    "LB",
    "MA",
    "DZ",
    "TN",
    "IQ",
    "SA",
  ],
  RU: ["RU", "BY", "KZ", "UA", "AM", "AZ", "GE", "UZ", "KG", "TJ", "TM", "MD"],
  SA: [
    "BR",
    "AR",
    "CL",
    "PE",
    "CO",
    "UY",
    "PY",
    "BO",
    "EC",
    "VE",
    "GY",
    "SR",
    "GF",
  ],
  NA: [
    "US",
    "CA",
    "MX",
    "AU",
    "NZ",
    "CR",
    "PA",
    "DO",
    "PR",
    "GT",
    "SV",
    "HN",
    "NI",
    "JM",
    "TT",
    "BS",
    "BB",
  ],
  EU: [
    "DE",
    "FR",
    "GB",
    "UK",
    "ES",
    "PT",
    "IT",
    "NL",
    "PL",
    "SE",
    "NO",
    "FI",
    "DK",
    "AT",
    "BE",
    "CH",
    "IE",
    "CZ",
    "GR",
    "HU",
    "RO",
    "BG",
    "HR",
    "SK",
    "SI",
    "LT",
    "LV",
    "EE",
    "LU",
    "MT",
    "CY",
    "IS",
    "RS",
    "BA",
    "MK",
    "AL",
    "ME",
    "ZA",
  ],
};

const COUNTRY_TO_REGION_MAP = Object.entries(REGION_BY_COUNTRIES).reduce(
  (acc, [regionCode, countries]) => {
    for (const country of countries) {
      acc[country] = regionCode;
    }
    return acc;
  },
  {},
);

function inferRegionFromCountry(countryCode) {
  if (!countryCode || typeof countryCode !== "string") {
    return "SA";
  }

  const normalizedCountry = countryCode.trim().toUpperCase();
  return COUNTRY_TO_REGION_MAP[normalizedCountry] || "SA";
}

function inferRegionFromHeaders(headers = {}) {
  if (!headers || typeof headers !== "object") {
    return "SA";
  }

  const countryCode =
    headers["x-vercel-ip-country"] ||
    headers["cf-ipcountry"] ||
    headers["x-country-code"] ||
    null;

  return inferRegionFromCountry(countryCode);
}

function getWinStreakBonus(consecutiveWins) {
  if (consecutiveWins >= 8) {
    return 8;
  }
  if (consecutiveWins >= 4) {
    return 5;
  }
  if (consecutiveWins >= 2) {
    return 2;
  }
  return 0;
}

function enrichMatchRows(rows) {
  let consecutiveWins = 0;

  return rows.map((row) => {
    const isWinner = row.is_winner === true;
    if (isWinner) {
      consecutiveWins += 1;
    } else {
      consecutiveWins = 0;
    }

    const streakBonus = isWinner ? getWinStreakBonus(consecutiveWins) : 0;
    const baseDelta =
      row.vary_rank_rating !== null ? Number(row.vary_rank_rating) : null;
    // Pearl Abyss's _myVaryRankRating already includes the Win Streak Bonus (+2, +5, +8).
    const effectiveDelta = baseDelta;

    return {
      record_no: Number(row.record_no),
      is_winner: isWinner,
      streak_count: consecutiveWins,
      streak_bonus: streakBonus,
      base_delta: baseDelta,
      effective_delta: effectiveDelta,
    };
  });
}

async function getEnrichedMatchHistory(region, nick, userNo = null) {
  const result = await database.query({
    text: `
      SELECT
        mp.record_no,
        mp.is_winner,
        mp.vary_rank_rating
      FROM
        solare_match_players mp
      WHERE
        mp.region = $1
        AND (
          ($3::bigint IS NOT NULL AND mp.user_no = $3::bigint)
          OR LOWER(mp.user_nickname) = LOWER($2)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM solare_match_mode_proofs smp
          WHERE smp.region = mp.region
            AND smp.record_no = mp.record_no
            AND smp.mode = 'practice'
        )
      ORDER BY
        mp.record_no ASC
      ;`,
    values: [region, nick, userNo],
  });

  return enrichMatchRows(result.rows);
}

function isEmptyParam(value) {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "")
  );
}

function validateRegion(region, fallbackRegion = "SA") {
  if (isEmptyParam(region)) {
    return VALID_REGIONS.includes(fallbackRegion) ? fallbackRegion : "SA";
  }

  if (typeof region !== "string") {
    throw new ValidationError({
      message: `Invalid region: '${region}'.`,
      action: "Valid regions are: SA, NA, EU, KR, JP, RU, TR, TW.",
    });
  }

  const normalizedRegion = region.toUpperCase().trim();

  if (!VALID_REGIONS.includes(normalizedRegion)) {
    throw new ValidationError({
      message: `Invalid region: '${region}'.`,
      action: "Valid regions are: SA, NA, EU, KR, JP, RU, TR, TW.",
    });
  }

  return normalizedRegion;
}

function validateSeason(season) {
  if (isEmptyParam(season)) {
    return null;
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

function validateClassType(classType) {
  if (isEmptyParam(classType)) {
    return null;
  }

  const parsed = Number(classType);

  if (
    typeof classType === "boolean" ||
    Array.isArray(classType) ||
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed > 35
  ) {
    throw new ValidationError({
      message: '"class_type" must be an integer between 0 and 35.',
      action: "Please provide a valid class_type.",
    });
  }

  return parsed;
}

function validatePage(page) {
  if (isEmptyParam(page)) {
    return 1;
  }

  const parsed = Number(page);

  if (
    typeof page === "boolean" ||
    Array.isArray(page) ||
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    throw new ValidationError({
      message: '"page" must be an integer greater than or equal to 1.',
      action: "Please provide a valid page number.",
    });
  }

  return parsed;
}

function validateLimit(limit) {
  if (isEmptyParam(limit)) {
    return 20;
  }

  const parsed = Number(limit);

  if (
    typeof limit === "boolean" ||
    Array.isArray(limit) ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > 50
  ) {
    throw new ValidationError({
      message: '"limit" must be an integer between 1 and 50.',
      action: "Please provide a limit between 1 and 50.",
    });
  }

  return parsed;
}

function validateNick(nick) {
  if (
    !nick ||
    typeof nick !== "string" ||
    nick.trim().length === 0 ||
    nick.trim().length > 64
  ) {
    throw new ValidationError({
      message:
        '"nick" is required and must be a string between 1 and 64 characters.',
      action: "Please provide a valid Family Name.",
    });
  }

  return nick.trim();
}

function validateRating(rating, isRequired) {
  if (rating === undefined || rating === null) {
    if (isRequired) {
      throw new ValidationError({
        message: '"rating" is required when starting a new session.',
        action: "Please provide your current Solare rating.",
      });
    }
    return null;
  }

  if (
    typeof rating !== "number" ||
    !Number.isInteger(rating) ||
    rating < 0 ||
    rating > 5000
  ) {
    throw new ValidationError({
      message: '"rating" must be an integer between 0 and 5000.',
      action: "Please provide a valid Solare rating.",
    });
  }

  return rating;
}

function validateToken(token) {
  if (token === undefined || token === null) {
    return null;
  }

  if (
    typeof token !== "string" ||
    token.trim().length === 0 ||
    token.trim().length > 64
  ) {
    throw new ValidationError({
      message: "Invalid session token.",
      action: "Please provide a valid session token.",
    });
  }

  return token.trim();
}

function validateSinceRecordNo(since) {
  if (isEmptyParam(since)) {
    return null;
  }

  const parsed = Number(since);

  if (
    typeof since === "boolean" ||
    Array.isArray(since) ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    throw new ValidationError({
      message: '"since" must be a non-negative integer.',
      action: "Please provide a valid match record_no for since.",
    });
  }

  return parsed;
}

function parseRecordNoFromEtag(etag) {
  if (typeof etag !== "string") {
    return null;
  }

  const match = etag.trim().match(/^(?:W\/)?"(\d+)(?::[^"]*)?"$/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function buildOverlayEtag({
  latestRecordNo,
  totalMatches = 0,
  ratedMatches = 0,
  sumVaryRating = 0,
  playerRow = null,
  sessionRow = null,
}) {
  const playerSegment = playerRow
    ? [
        Number(playerRow.win_count || 0),
        Number(playerRow.lose_count || 0),
        Number(playerRow.draw_count || 0),
        playerRow.rank_rating !== null && playerRow.rank_rating !== undefined
          ? Number(playerRow.rank_rating)
          : "n",
        playerRow.current_ranking !== null &&
        playerRow.current_ranking !== undefined
          ? playerRow.ranking_superseded
            ? `s${Number(playerRow.current_ranking)}`
            : Number(playerRow.current_ranking)
          : "n",
        playerRow.class_type !== null && playerRow.class_type !== undefined
          ? Number(playerRow.class_type)
          : "n",
        playerRow.skill_branch_type !== null &&
        playerRow.skill_branch_type !== undefined
          ? Number(playerRow.skill_branch_type)
          : "n",
      ].join(":")
    : "np";

  const base = `${latestRecordNo}:${totalMatches}:${ratedMatches}:${sumVaryRating}:${playerSegment}`;

  if (sessionRow) {
    return `W/"${base}:${Number(sessionRow.anchor_record_no)}:${Number(sessionRow.session_start_record_no)}:${Number(sessionRow.anchor_rating)}"`;
  }

  return `W/"${base}"`;
}

async function findPlayerIdentityAndWatermark(
  region,
  nick,
  knownUserNo = null,
) {
  const playerResult = await database.query({
    text: `
      SELECT
        user_nickname,
        user_no,
        rank_rating
      FROM
        solare_players
      WHERE
        region = $1
        AND (
          ($3::bigint IS NOT NULL AND user_no = $3::bigint)
          OR LOWER(user_nickname) = LOWER($2)
        )
      ORDER BY
        updated_at DESC
      LIMIT 1
      ;`,
    values: [region, nick, knownUserNo],
  });

  const resolvedUserNo = playerResult.rows[0]?.user_no || knownUserNo || null;

  const matchResult = await database.query({
    text: `
      SELECT
        MAX(mp.record_no) AS latest_record_no,
        (ARRAY_AGG(mp.user_nickname ORDER BY mp.record_no DESC))[1] AS latest_nickname,
        (ARRAY_AGG(mp.user_no ORDER BY mp.record_no DESC) FILTER (WHERE mp.user_no IS NOT NULL))[1] AS latest_user_no,
        COUNT(*)::int AS match_count
      FROM
        solare_match_players mp
      WHERE
        mp.region = $1
        AND (
          ($3::bigint IS NOT NULL AND mp.user_no = $3::bigint)
          OR LOWER(mp.user_nickname) = LOWER($2)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM solare_match_mode_proofs smp
          WHERE smp.region = mp.region
            AND smp.record_no = mp.record_no
            AND smp.mode = 'practice'
        )
      ;`,
    values: [region, nick, resolvedUserNo],
  });

  const playerRow = playerResult.rows[0] || null;
  const matchRow = matchResult.rows[0] || null;
  const hasMatches = matchRow && matchRow.match_count > 0;

  if (!playerRow && !hasMatches) {
    throw new NotFoundError({
      message: `Player '${nick}' was not found in region '${region}'.`,
      action: "Check if the Family Name and region are spelled correctly.",
    });
  }

  return {
    user_nickname:
      playerRow?.user_nickname || matchRow?.latest_nickname || nick,
    user_no:
      playerRow?.user_no || matchRow?.latest_user_no || knownUserNo || null,
    rank_rating:
      playerRow?.rank_rating !== null && playerRow?.rank_rating !== undefined
        ? Number(playerRow.rank_rating)
        : null,
    latest_record_no: matchRow?.latest_record_no
      ? Number(matchRow.latest_record_no)
      : 0,
  };
}

async function createOrResetSession(sessionInput) {
  if (
    !sessionInput ||
    typeof sessionInput !== "object" ||
    Array.isArray(sessionInput)
  ) {
    throw new ValidationError({
      message: "Invalid session object.",
      action: "Verify if the session payload is typed correctly.",
    });
  }

  const nick = validateNick(sessionInput.nick);
  const region = validateRegion(sessionInput.region);
  const token = validateToken(sessionInput.token);
  const explicitRating = validateRating(sessionInput.rating, false);

  let playerIdentity;
  try {
    playerIdentity = await findPlayerIdentityAndWatermark(region, nick);
  } catch (error) {
    if (error instanceof NotFoundError && !token && explicitRating === null) {
      throw new ValidationError({
        message: '"rating" is required when starting a new session.',
        action: "Please provide your current Solare rating.",
      });
    }
    throw error;
  }

  if (token) {
    return await resetExistingSession({
      token,
      region,
      playerIdentity,
      explicitRating,
    });
  }

  const initialAnchorRating =
    explicitRating !== null ? explicitRating : playerIdentity.rank_rating;

  if (initialAnchorRating === null || initialAnchorRating === undefined) {
    throw new ValidationError({
      message: '"rating" is required when starting a new session.',
      action: "Please provide your current Solare rating.",
    });
  }

  return await runInsertSessionQuery({
    region,
    playerIdentity,
    anchorRating: initialAnchorRating,
  });

  async function runInsertSessionQuery({
    region,
    playerIdentity,
    anchorRating,
  }) {
    const generatedToken = crypto.randomBytes(24).toString("hex");

    const results = await database.query({
      text: `
        INSERT INTO
          solare_overlay_sessions (
            token,
            region,
            user_nickname,
            user_no,
            anchor_rating,
            anchor_record_no,
            session_start_record_no
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $6)
        RETURNING
          *
        ;`,
      values: [
        generatedToken,
        region,
        playerIdentity.user_nickname,
        playerIdentity.user_no,
        anchorRating,
        playerIdentity.latest_record_no,
      ],
    });

    return results.rows[0];
  }

  async function resetExistingSession({
    token,
    region,
    playerIdentity,
    explicitRating,
  }) {
    const existingResult = await database.query({
      text: `
        SELECT
          *
        FROM
          solare_overlay_sessions
        WHERE
          token = $1
        LIMIT 1
        ;`,
      values: [token],
    });

    if (existingResult.rowCount === 0) {
      throw new NotFoundError({
        message: "Overlay session not found.",
        action: "Verify if the session token is valid or start a new session.",
      });
    }

    const existingSession = existingResult.rows[0];

    const isSameUserNo =
      existingSession.user_no &&
      playerIdentity.user_no &&
      String(existingSession.user_no) === String(playerIdentity.user_no);
    const isSameNick =
      existingSession.user_nickname.toLowerCase() ===
      playerIdentity.user_nickname.toLowerCase();

    if (
      existingSession.region.toUpperCase() !== region ||
      (!isSameUserNo && !isSameNick)
    ) {
      throw new ForbiddenError({
        message: "This session token belongs to a different player or region.",
        action: "Create a new session for this player instead.",
      });
    }

    const effectiveUserNo =
      playerIdentity.user_no || existingSession.user_no || null;

    let nextAnchorRating = explicitRating;

    if (nextAnchorRating === null) {
      const enrichedMatches = await getEnrichedMatchHistory(
        region,
        playerIdentity.user_nickname,
        effectiveUserNo,
      );

      const anchorRecordNo = Number(existingSession.anchor_record_no);
      const deltaSum = enrichedMatches
        .filter(
          (m) => m.record_no > anchorRecordNo && m.effective_delta !== null,
        )
        .reduce((sum, m) => sum + m.effective_delta, 0);

      nextAnchorRating = Math.max(
        0,
        Number(existingSession.anchor_rating) + deltaSum,
      );
    }

    const updatedResult = await database.query({
      text: `
        UPDATE
          solare_overlay_sessions
        SET
          user_nickname = $2,
          user_no = COALESCE($3, user_no),
          anchor_rating = $4,
          anchor_record_no = $5,
          session_start_record_no = $5,
          started_at = timezone('utc', now()),
          updated_at = timezone('utc', now())
        WHERE
          id = $1
        RETURNING
          *
        ;`,
      values: [
        existingSession.id,
        playerIdentity.user_nickname,
        effectiveUserNo,
        nextAnchorRating,
        playerIdentity.latest_record_no,
      ],
    });

    return updatedResult.rows[0];
  }
}

async function getOverlayData({
  nick,
  region,
  token,
  since,
  ifNoneMatch,
} = {}) {
  const validatedToken = validateToken(token);
  const validatedSince = validateSinceRecordNo(since);
  const targetSinceRecordNo =
    validatedSince !== null
      ? validatedSince
      : parseRecordNoFromEtag(ifNoneMatch);

  if (
    !validatedToken &&
    (!nick || typeof nick !== "string" || nick.trim().length === 0)
  ) {
    throw new ValidationError({
      message: '"nick" or "token" is required.',
      action: "Please provide a Family Name or a valid overlay session token.",
    });
  }

  let sessionRow = null;
  let targetRegion = validateRegion(region);
  let targetNick = nick ? validateNick(nick) : null;
  let targetUserNo = null;

  if (validatedToken) {
    const sessionResult = await database.query({
      text: `
        SELECT
          *
        FROM
          solare_overlay_sessions
        WHERE
          token = $1
        LIMIT 1
        ;`,
      values: [validatedToken],
    });

    if (sessionResult.rowCount === 0) {
      throw new NotFoundError({
        message: "Overlay session not found.",
        action: "Verify if the session token is valid or start a new session.",
      });
    }

    sessionRow = sessionResult.rows[0];
    targetRegion = sessionRow.region.toUpperCase();
    targetNick = sessionRow.user_nickname;
    targetUserNo = sessionRow.user_no || null;

    // Touch session updated_at at most once every 5 minutes so the crawler can prioritize active OBS overlays.
    const lastUpdatedMs = sessionRow.updated_at
      ? new Date(sessionRow.updated_at).getTime()
      : 0;
    if (Date.now() - lastUpdatedMs > 5 * 60 * 1000) {
      await database.query({
        text: `
          UPDATE
            solare_overlay_sessions
          SET
            updated_at = timezone('utc', now())
          WHERE
            id = $1
          ;`,
        values: [sessionRow.id],
      });
    }
  }

  const playerResult = await database.query({
    text: `
      SELECT
        sp.*,
        (
          EXISTS (
            SELECT 1
            FROM solare_players sp2
            WHERE sp2.region = sp.region
              AND sp2.current_ranking = sp.current_ranking
              AND COALESCE(sp2.season, 9) = COALESCE(sp.season, 9)
              AND sp2.user_no IS DISTINCT FROM sp.user_no
              AND COALESCE(sp2.last_seen_at, sp2.updated_at) > COALESCE(sp.last_seen_at, sp.updated_at)
          )
          OR EXISTS (
            SELECT 1
            FROM solare_players sp3
            WHERE sp3.region = sp.region
              AND COALESCE(sp3.season, 9) > COALESCE(sp.season, 9)
          )
        ) AS ranking_superseded
      FROM
        solare_players sp
      WHERE
        sp.region = $1
        AND (
          ($3::bigint IS NOT NULL AND sp.user_no = $3::bigint)
          OR LOWER(sp.user_nickname) = LOWER($2)
        )
      ORDER BY
        sp.updated_at DESC
      LIMIT 1
      ;`,
    values: [targetRegion, targetNick, targetUserNo],
  });

  const playerRow = playerResult.rows[0] || null;
  const resolvedUserNo = playerRow?.user_no || targetUserNo || null;
  const isActiveTop100Player =
    playerRow !== null &&
    playerRow.current_ranking !== null &&
    playerRow.current_ranking !== undefined &&
    Number(playerRow.current_ranking) >= 1 &&
    Number(playerRow.current_ranking) <= 100 &&
    !playerRow.ranking_superseded;

  if (targetSinceRecordNo !== null) {
    const latestRecordResult = await database.query({
      text: `
        SELECT
          COUNT(*)::int AS total_matches,
          COUNT(mp.vary_rank_rating)::int AS rated_matches,
          COALESCE(SUM(mp.vary_rank_rating), 0)::int AS sum_vary_rating,
          MAX(mp.record_no) AS max_record_no,
          (ARRAY_AGG(mp.vary_rank_rating ORDER BY mp.record_no DESC))[1] AS latest_vary_rank_rating
        FROM
          solare_match_players mp
        WHERE
          mp.region = $1
          AND (
            ($3::bigint IS NOT NULL AND mp.user_no = $3::bigint)
            OR LOWER(mp.user_nickname) = LOWER($2)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM solare_match_mode_proofs smp
            WHERE smp.region = mp.region
              AND smp.record_no = mp.record_no
              AND smp.mode = 'practice'
          )
        ;`,
      values: [targetRegion, targetNick, resolvedUserNo],
    });

    const totalMatchesCount = Number(
      latestRecordResult.rows[0]?.total_matches || 0,
    );
    const ratedMatchesCount = Number(
      latestRecordResult.rows[0]?.rated_matches || 0,
    );
    const sumVaryRatingCount = Number(
      latestRecordResult.rows[0]?.sum_vary_rating || 0,
    );
    const currentLatestRecordNo = latestRecordResult.rows[0]?.max_record_no
      ? Number(latestRecordResult.rows[0].max_record_no)
      : 0;
    const latestVaryRankRating =
      latestRecordResult.rows[0]?.latest_vary_rank_rating ?? null;

    if (!playerRow && totalMatchesCount === 0) {
      throw new NotFoundError({
        message: `Player '${targetNick}' was not found in region '${targetRegion}'.`,
        action: "Check if the Family Name and region are spelled correctly.",
      });
    }

    const currentEtag = buildOverlayEtag({
      latestRecordNo: currentLatestRecordNo,
      totalMatches: totalMatchesCount,
      ratedMatches: ratedMatchesCount,
      sumVaryRating: sumVaryRatingCount,
      playerRow,
      sessionRow,
    });
    const trimmedIfNoneMatch =
      typeof ifNoneMatch === "string" ? ifNoneMatch.trim() : "";
    // The ETag captures match count, rated-match count/sum, player W/L/rating,
    // and session anchor/start/rating so two-stage crawler updates (where
    // vary_rank_rating and solare_players arrive after record_no is first
    // inserted via another participant) invalidate 304 immediately.
    const etagMatches = sessionRow
      ? trimmedIfNoneMatch === currentEtag
      : trimmedIfNoneMatch.length > 0
        ? trimmedIfNoneMatch === currentEtag
        : !isActiveTop100Player ||
          totalMatchesCount === 0 ||
          latestVaryRankRating !== null;

    if (currentLatestRecordNo === targetSinceRecordNo && etagMatches) {
      return {
        not_modified: true,
        latest_record_no: currentLatestRecordNo,
        etag: currentEtag,
      };
    }
  }

  const matchesResult = await database.query({
    text: `
      SELECT
        mp.record_no,
        mp.user_nickname,
        mp.user_no,
        mp.class_type,
        mp.skill_branch_type,
        mp.is_winner,
        mp.vary_rank_rating,
        mp.kill_count,
        mp.death_count,
        mp.cc_applied_count,
        mp.damage_done,
        mp.damage_taken,
        mp.recovery,
        COALESCE(m.match_date, m.crawled_at, mp.created_at) AS match_date
      FROM
        solare_match_players mp
      LEFT JOIN
        solare_matches m
        ON m.region = mp.region AND m.record_no = mp.record_no
      WHERE
        mp.region = $1
        AND (
          ($3::bigint IS NOT NULL AND mp.user_no = $3::bigint)
          OR LOWER(mp.user_nickname) = LOWER($2)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM solare_match_mode_proofs smp
          WHERE smp.region = mp.region
            AND smp.record_no = mp.record_no
            AND smp.mode = 'practice'
        )
      ORDER BY
        mp.record_no ASC
      ;`,
    values: [targetRegion, targetNick, resolvedUserNo],
  });

  const matchRows = matchesResult.rows;
  const totalMatches = matchRows.length;
  const hasMatches = totalMatches > 0;

  if (!playerRow && !hasMatches) {
    throw new NotFoundError({
      message: `Player '${targetNick}' was not found in region '${targetRegion}'.`,
      action: "Check if the Family Name and region are spelled correctly.",
    });
  }

  const latestMatchRow = hasMatches ? matchRows[totalMatches - 1] : null;
  let latestUserNo = null;
  let matchWins = 0;
  let matchLosses = 0;
  let ratedMatches = 0;
  let sumVaryRating = 0;
  let sumKills = 0;
  let sumDeaths = 0;
  let sumCc = 0;
  let sumDamageDone = 0;
  let sumDamageTaken = 0;
  let sumRecovery = 0;

  for (let i = 0; i < totalMatches; i += 1) {
    const row = matchRows[i];
    if (row.user_no !== null && row.user_no !== undefined) {
      latestUserNo = row.user_no;
    }
    if (row.is_winner === true) {
      matchWins += 1;
    } else if (row.is_winner === false) {
      matchLosses += 1;
    }
    if (row.vary_rank_rating !== null && row.vary_rank_rating !== undefined) {
      ratedMatches += 1;
      sumVaryRating += Number(row.vary_rank_rating);
    }
    sumKills += Number(row.kill_count || 0);
    sumDeaths += Number(row.death_count || 0);
    sumCc += Number(row.cc_applied_count || 0);
    sumDamageDone += Number(row.damage_done || 0);
    sumDamageTaken += Number(row.damage_taken || 0);
    sumRecovery += Number(row.recovery || 0);
  }

  const canonicalNick =
    playerRow?.user_nickname || latestMatchRow?.user_nickname || targetNick;
  const canonicalUserNo =
    playerRow?.user_no || latestUserNo || resolvedUserNo || null;
  const classType = playerRow?.class_type ?? latestMatchRow?.class_type ?? null;
  const skillBranchType =
    playerRow?.skill_branch_type ?? latestMatchRow?.skill_branch_type ?? null;
  const latestRecordNo = latestMatchRow?.record_no
    ? Number(latestMatchRow.record_no)
    : 0;

  const overallWins = playerRow ? Number(playerRow.win_count) : matchWins;
  const overallLosses = playerRow ? Number(playerRow.lose_count) : matchLosses;
  const overallDraws = playerRow ? Number(playerRow.draw_count) : 0;
  const overallTotalGames = overallWins + overallLosses + overallDraws;
  const overallWinrate =
    overallTotalGames > 0
      ? Number(((overallWins / overallTotalGames) * 100).toFixed(1))
      : 0;

  let rating =
    playerRow?.rank_rating !== null && playerRow?.rank_rating !== undefined
      ? Number(playerRow.rank_rating)
      : null;
  let sessionStats = null;

  if (sessionRow) {
    const enrichedMatches = enrichMatchRows(matchRows);

    const anchorRecordNo = Number(sessionRow.anchor_record_no);
    const sessionStartRecordNo = Number(sessionRow.session_start_record_no);

    const anchorDeltaSum = enrichedMatches
      .filter((m) => m.record_no > anchorRecordNo && m.effective_delta !== null)
      .reduce((sum, m) => sum + m.effective_delta, 0);

    rating = Math.max(0, Number(sessionRow.anchor_rating) + anchorDeltaSum);

    // Active Top-100 players receive vary_rank_rating on every ranked match once
    // their own match list is crawled; rows with effective_delta === null are
    // either half-crawled (discovered via another participant first) or practice
    // matches, and must not tick TODAY RECORD ahead of rating/net_pdl.
    const sessionRowsDesc = enrichedMatches
      .filter(
        (m) =>
          m.record_no > sessionStartRecordNo &&
          (!isActiveTop100Player || m.effective_delta !== null),
      )
      .reverse();

    const sessionWins = sessionRowsDesc.filter(
      (r) => r.is_winner === true,
    ).length;
    const sessionLosses = sessionRowsDesc.filter(
      (r) => r.is_winner === false,
    ).length;
    const sessionDraws = 0;
    const sessionTotalGames = sessionRowsDesc.length;
    const sessionWinrate =
      sessionTotalGames > 0
        ? Number(((sessionWins / sessionTotalGames) * 100).toFixed(1))
        : 0;
    const netPdl = sessionRowsDesc.reduce(
      (sum, r) => sum + (r.effective_delta !== null ? r.effective_delta : 0),
      0,
    );
    const recentDeltas = sessionRowsDesc
      .filter((r) => r.effective_delta !== null)
      .slice(0, 5)
      .map((r) => r.effective_delta);

    sessionStats = {
      anchor_rating: Number(sessionRow.anchor_rating),
      anchor_record_no: anchorRecordNo,
      session_start_record_no: sessionStartRecordNo,
      wins: sessionWins,
      losses: sessionLosses,
      draws: sessionDraws,
      total_games: sessionTotalGames,
      winrate: sessionWinrate,
      net_pdl: netPdl,
      recent_deltas: recentDeltas,
    };
  }

  const latestMatch = hasMatches
    ? {
        record_no: latestRecordNo,
        is_winner: Boolean(latestMatchRow.is_winner),
        kills: Number(latestMatchRow.kill_count || 0),
        deaths: Number(latestMatchRow.death_count || 0),
        cc: Number(latestMatchRow.cc_applied_count || 0),
        damage_done: Number(latestMatchRow.damage_done || 0),
        damage_taken: Number(latestMatchRow.damage_taken || 0),
        recovery: Number(latestMatchRow.recovery || 0),
        match_date: latestMatchRow.match_date
          ? new Date(latestMatchRow.match_date).toISOString()
          : null,
      }
    : null;

  const responseEtag = buildOverlayEtag({
    latestRecordNo,
    totalMatches,
    ratedMatches,
    sumVaryRating,
    playerRow,
    sessionRow,
  });

  const resultPayload = {
    region: targetRegion,
    user_nickname: canonicalNick,
    user_no: canonicalUserNo ? String(canonicalUserNo) : null,
    current_ranking:
      playerRow?.current_ranking !== null &&
      playerRow?.current_ranking !== undefined
        ? Number(playerRow.current_ranking)
        : null,
    class_type: classType !== null ? Number(classType) : null,
    skill_branch_type:
      skillBranchType !== null ? Number(skillBranchType) : null,
    rating,
    latest_record_no: latestRecordNo,
    latest_match: latestMatch,
    overall: {
      wins: overallWins,
      losses: overallLosses,
      draws: overallDraws,
      total_games: overallTotalGames,
      winrate: overallWinrate,
    },
    averages: {
      kills: hasMatches ? Number((sumKills / totalMatches).toFixed(1)) : 0,
      deaths: hasMatches ? Number((sumDeaths / totalMatches).toFixed(1)) : 0,
      cc: hasMatches ? Number((sumCc / totalMatches).toFixed(1)) : 0,
      damage_done: hasMatches ? Math.round(sumDamageDone / totalMatches) : 0,
      damage_taken: hasMatches ? Math.round(sumDamageTaken / totalMatches) : 0,
      recovery: hasMatches ? Math.round(sumRecovery / totalMatches) : 0,
    },
    session: sessionStats,
  };

  Object.defineProperty(resultPayload, "etag", {
    value: responseEtag,
    enumerable: false,
  });

  return resultPayload;
}

async function getChatSummary({ nick, region, token } = {}) {
  const data = await getOverlayData({ nick, region, token });

  const className = getClassName(data.class_type);
  const userNickname = data.user_nickname;
  const spec = getSkillBranch(data.class_type, data.skill_branch_type);
  const ranking = data.current_ranking;
  const rating = data.rating;
  const solareTierObject = getTierInfo(rating, ranking);
  const solareTierName = solareTierObject.name;
  const selectedRegion = data.region;
  const overall = data.overall;
  const session = data.session;

  const outputPart1 = `[${selectedRegion}] ${userNickname} (${className} ${spec}) — Rank #${ranking}`;
  const outputPart3 = `Season: ${overall.wins}W ${overall.losses}L (${overall.winrate}% WR)`;

  if (session) {
    const netPts =
      session.net_pdl >= 0 ? `+${session.net_pdl}` : `${session.net_pdl}`;
    const outputPart2 = `${solareTierName} (${rating} PTS) | Live: ${session.wins}W ${session.losses}L (${netPts} PTS)`;

    return `${outputPart1} | ${outputPart2} | ${outputPart3}`;
  }

  return `${outputPart1} | ${outputPart3}`;
}

function normalizeWinRecord(winRecord, playerTeam) {
  if (!Array.isArray(winRecord)) {
    return null;
  }

  const normalized = winRecord.map((r) => Number(r));

  if (Number(playerTeam) === 1) {
    return normalized.map((r) => (r === 2 ? 3 : r === 3 ? 2 : r));
  }

  return normalized;
}

function formatMatchParticipant(row) {
  return {
    user_nickname: row.user_nickname,
    user_no:
      row.user_no !== null && row.user_no !== undefined
        ? String(row.user_no)
        : null,
    class_type: Number(row.class_type),
    skill_branch_type: Number(row.skill_branch_type),
    kill_count: Number(row.kill_count || 0),
    death_count: Number(row.death_count || 0),
    cc_applied_count: Number(row.cc_applied_count || 0),
    damage_done: Number(row.damage_done || 0),
    damage_taken: Number(row.damage_taken || 0),
    recovery: Number(row.recovery || 0),
    is_winner: Boolean(row.is_winner),
    vary_rank_rating:
      row.vary_rank_rating !== null && row.vary_rank_rating !== undefined
        ? Number(row.vary_rank_rating)
        : null,
  };
}

async function resolvePlayerIdentityAndSeason({
  targetNick,
  targetRegion,
  requestedSeason,
}) {
  const playerResult = await database.query({
    text: `
      SELECT
        *
      FROM
        solare_players
      WHERE
        region = $1
        AND LOWER(user_nickname) = LOWER($2)
      ORDER BY
        CASE WHEN $3::smallint IS NOT NULL AND season = $3::smallint THEN 0 ELSE 1 END,
        season DESC NULLS LAST,
        updated_at DESC
      LIMIT 1
      ;`,
    values: [targetRegion, targetNick, requestedSeason],
  });

  let playerRow = playerResult.rows[0] || null;
  let resolvedUserNo = playerRow?.user_no || null;
  let identityNickname = null;

  if (!resolvedUserNo) {
    const identityResult = await database.query({
      text: `
        SELECT
          user_no,
          user_nickname
        FROM
          solare_match_players
        WHERE
          region = $1
          AND LOWER(user_nickname) = LOWER($2)
        ORDER BY
          CASE WHEN user_no IS NOT NULL THEN 0 ELSE 1 END,
          record_no DESC
        LIMIT 1
        ;`,
      values: [targetRegion, targetNick],
    });

    if (!playerRow && identityResult.rowCount === 0) {
      throw new NotFoundError({
        message: `Player '${targetNick}' was not found in region '${targetRegion}'.`,
        action: "Check if the Family Name and region are spelled correctly.",
      });
    }

    resolvedUserNo = identityResult.rows[0]?.user_no || null;
    identityNickname = identityResult.rows[0]?.user_nickname || null;

    if (!playerRow && resolvedUserNo) {
      const playerByUserNoResult = await database.query({
        text: `
          SELECT
            *
          FROM
            solare_players
          WHERE
            region = $1
            AND user_no = $2::bigint
          ORDER BY
            CASE WHEN $3::smallint IS NOT NULL AND season = $3::smallint THEN 0 ELSE 1 END,
            season DESC NULLS LAST,
            updated_at DESC
          LIMIT 1
          ;`,
        values: [targetRegion, resolvedUserNo, requestedSeason],
      });

      playerRow = playerByUserNoResult.rows[0] || null;
    }
  }

  let targetSeason = requestedSeason;
  if (targetSeason === null) {
    if (playerRow?.season) {
      targetSeason = Number(playerRow.season);
    } else {
      const seasonResult = await database.query({
        text: `
          SELECT
            MAX(m.season)::smallint AS latest_season
          FROM
            solare_match_players mp
          INNER JOIN
            solare_matches m
            ON m.region = mp.region AND m.record_no = mp.record_no
          WHERE
            mp.region = $1
            AND (
              ($3::bigint IS NOT NULL AND mp.user_no = $3::bigint)
              OR (($3::bigint IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER($2))
            )
            AND NOT EXISTS (
              SELECT 1
              FROM solare_match_mode_proofs smp
              WHERE smp.region = mp.region
                AND smp.record_no = mp.record_no
                AND smp.mode = 'practice'
            )
          ;`,
        values: [targetRegion, targetNick, resolvedUserNo],
      });

      targetSeason = seasonResult.rows[0]?.latest_season
        ? Number(seasonResult.rows[0].latest_season)
        : 9;
    }
  }

  return {
    playerRow,
    resolvedUserNo,
    identityNickname,
    targetSeason,
  };
}

// Most played class (and branch) for every row of a `deduplicated_ranking` CTE, computed set-based.
// A per-row LATERAL subquery with an `user_no = x OR LOWER(nick) = y` predicate turned every ranking
// lookup into one nested loop per ranked player (~7s for a full region). Here the season's non-practice
// match players are aggregated once per (user_no, nickname, class, branch) and then joined twice:
// by user_no when both sides have one, and by nickname when either side lacks it. Those two conditions
// are mutually exclusive, so UNION ALL never double counts. Expects $1 = region and $2 = season.
const RANKING_MOST_PLAYED_CLASS_CTES = `
  ranking_players AS (
    SELECT
      ROW_NUMBER() OVER () AS dr_id,
      dr.*
    FROM
      deduplicated_ranking dr
  ),
  season_class_counts AS (
    SELECT
      mp.user_no,
      LOWER(mp.user_nickname) AS nick_lower,
      mp.class_type,
      mp.skill_branch_type,
      COUNT(*)::int AS games,
      COUNT(*) FILTER (WHERE mp.is_winner IS TRUE)::int AS wins
    FROM
      solare_match_players mp
    INNER JOIN
      solare_matches m
      ON m.region = mp.region AND m.record_no = mp.record_no
    WHERE
      mp.region = $1
      AND (
        m.season = $2
        OR ($2 = 9 AND m.season IS NULL)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM solare_match_mode_proofs smp
        WHERE smp.region = mp.region
          AND smp.record_no = mp.record_no
          AND smp.mode = 'practice'
      )
    GROUP BY
      mp.user_no,
      LOWER(mp.user_nickname),
      mp.class_type,
      mp.skill_branch_type
  ),
  player_class_counts AS (
    SELECT
      rp.dr_id,
      scc.class_type,
      scc.skill_branch_type,
      scc.games,
      scc.wins
    FROM
      ranking_players rp
    INNER JOIN
      season_class_counts scc
      ON rp.user_no IS NOT NULL AND scc.user_no = rp.user_no
    UNION ALL
    SELECT
      rp.dr_id,
      scc.class_type,
      scc.skill_branch_type,
      scc.games,
      scc.wins
    FROM
      ranking_players rp
    INNER JOIN
      season_class_counts scc
      ON scc.nick_lower = LOWER(rp.user_nickname)
      AND (rp.user_no IS NULL OR scc.user_no IS NULL)
  ),
  most_played_class AS (
    SELECT DISTINCT ON (dr_id)
      dr_id,
      class_type,
      skill_branch_type
    FROM (
      SELECT
        dr_id,
        class_type,
        skill_branch_type,
        SUM(games) AS games,
        SUM(wins) AS wins
      FROM
        player_class_counts
      GROUP BY
        dr_id,
        class_type,
        skill_branch_type
    ) totals
    ORDER BY
      dr_id,
      games DESC,
      wins DESC,
      class_type ASC,
      skill_branch_type ASC
  )`;

async function resolvePlayerRankingPositions({
  isPlayerRowForTargetSeason,
  playerRow,
  targetRegion,
  targetSeason,
  canonicalUserNo,
  canonicalNick,
}) {
  let activeCurrentRanking = null;
  let activeOfficialRanking =
    isPlayerRowForTargetSeason && playerRow?.current_ranking !== null
      ? Number(playerRow.current_ranking)
      : null;
  let activeClassRanking = null;

  if (
    isPlayerRowForTargetSeason &&
    (playerRow.current_ranking !== null ||
      (playerRow.rank_rating !== null &&
        playerRow.rank_rating !== undefined &&
        !playerRow.rating_is_estimated))
  ) {
    const rankingPositionResult = await database.query({
      text: `
        WITH deduplicated_ranking AS (
          SELECT DISTINCT ON (
            CASE
              WHEN current_ranking IS NOT NULL AND current_ranking < ${SOLARE_SHARED_RANK_FLOOR} THEN 'r:' || current_ranking::text
              ELSE 'u:' || COALESCE(user_no::text, LOWER(user_nickname))
            END
          )
            user_no,
            user_nickname,
            current_ranking,
            rank_rating,
            rating_achieved_record_no,
            class_type,
            win_count
          FROM
            solare_players
          WHERE
            region = $1
            AND (
              (current_ranking IS NOT NULL AND current_ranking >= 1)
              OR (rank_rating IS NOT NULL AND NOT COALESCE(rating_is_estimated, FALSE))
            )
            AND (
              season = $2
              OR ($2 = 9 AND season IS NULL)
            )
            AND NOT (
              current_ranking IS NULL
              AND EXISTS (
                SELECT 1
                FROM solare_players sp_dup
                WHERE sp_dup.region = solare_players.region
                  AND (sp_dup.season = $2 OR ($2 = 9 AND sp_dup.season IS NULL))
                  AND sp_dup.current_ranking IS NOT NULL
                  AND sp_dup.current_ranking >= 1
                  AND (
                    (solare_players.user_no IS NOT NULL AND sp_dup.user_no = solare_players.user_no)
                    OR (
                      (solare_players.user_no IS NULL OR sp_dup.user_no IS NULL)
                      AND LOWER(sp_dup.user_nickname) = LOWER(solare_players.user_nickname)
                    )
                  )
              )
            )
          ORDER BY
            CASE
              WHEN current_ranking IS NOT NULL AND current_ranking < ${SOLARE_SHARED_RANK_FLOOR} THEN 'r:' || current_ranking::text
              ELSE 'u:' || COALESCE(user_no::text, LOWER(user_nickname))
            END ASC,
            COALESCE(last_seen_at, updated_at) DESC NULLS LAST,
            updated_at DESC NULLS LAST,
            win_count DESC
        ),
        ${RANKING_MOST_PLAYED_CLASS_CTES},
        ranking_with_most_played_class AS (
          SELECT
            rp.user_no,
            rp.user_nickname,
            rp.current_ranking,
            rp.rank_rating,
            rp.rating_achieved_record_no,
            rp.win_count,
            COALESCE(mpc.class_type, rp.class_type)::smallint AS class_type
          FROM
            ranking_players rp
          LEFT JOIN
            most_played_class mpc ON mpc.dr_id = rp.dr_id
        ),
        ranked_with_class AS (
          SELECT
            user_no,
            user_nickname,
            current_ranking,
            CASE
              WHEN rank_rating IS NOT NULL THEN
                ROW_NUMBER() OVER (
                  ORDER BY
                    CASE WHEN rank_rating IS NOT NULL THEN 0 ELSE 1 END ASC,
                    rank_rating DESC NULLS LAST,
                    current_ranking ASC NULLS LAST,
                    rating_achieved_record_no ASC NULLS LAST,
                    win_count DESC
                )::int
              ELSE current_ranking
            END AS effective_ranking,
            class_type,
            ROW_NUMBER() OVER (
              PARTITION BY class_type
              ORDER BY
                CASE WHEN rank_rating IS NOT NULL THEN 0 ELSE 1 END ASC,
                rank_rating DESC NULLS LAST,
                current_ranking ASC NULLS LAST,
                rating_achieved_record_no ASC NULLS LAST,
                win_count DESC
            )::int AS class_ranking
          FROM
            ranking_with_most_played_class
        )
        SELECT
          current_ranking,
          effective_ranking,
          class_ranking
        FROM
          ranked_with_class
        WHERE
          ($3::bigint IS NOT NULL AND user_no = $3::bigint)
          OR (($3::bigint IS NULL OR user_no IS NULL) AND LOWER(user_nickname) = LOWER($4))
        ORDER BY
          CASE WHEN $3::bigint IS NOT NULL AND user_no = $3::bigint THEN 0 ELSE 1 END ASC,
          effective_ranking ASC NULLS LAST
        LIMIT 1
        ;`,
      values: [targetRegion, targetSeason, canonicalUserNo, canonicalNick],
    });

    if (rankingPositionResult.rowCount > 0) {
      activeCurrentRanking = Number(
        rankingPositionResult.rows[0].effective_ranking,
      );
      if (rankingPositionResult.rows[0].current_ranking !== null) {
        activeOfficialRanking = Number(
          rankingPositionResult.rows[0].current_ranking,
        );
      }
      activeClassRanking = Number(rankingPositionResult.rows[0].class_ranking);
    } else {
      // Stale "ghost" row: a newer player now holds this official rank in GetRankList.
      activeOfficialRanking = null;
    }
  }

  return {
    activeCurrentRanking,
    activeOfficialRanking,
    activeClassRanking,
  };
}

async function getPlayerSummary({ nick, region, countryCode, season } = {}) {
  const targetNick = validateNick(nick);
  const fallbackRegion = inferRegionFromCountry(countryCode);
  const targetRegion = validateRegion(region, fallbackRegion);
  const requestedSeason = validateSeason(season);

  const { playerRow, resolvedUserNo, identityNickname, targetSeason } =
    await resolvePlayerIdentityAndSeason({
      targetNick,
      targetRegion,
      requestedSeason,
    });

  const summaryStatsResult = await database.query({
    text: `
      WITH season_matches AS (
        SELECT
          mp.record_no,
          mp.user_nickname,
          mp.user_no,
          mp.class_type,
          mp.skill_branch_type,
          mp.is_winner,
          mp.kill_count,
          mp.death_count,
          mp.cc_applied_count,
          mp.damage_done,
          mp.damage_taken,
          mp.recovery
        FROM
          solare_match_players mp
        INNER JOIN
          solare_matches m
          ON m.region = mp.region AND m.record_no = mp.record_no
        WHERE
          mp.region = $1
          AND (
            m.season = $4
            OR ($4 = 9 AND m.season IS NULL)
          )
          AND (
            ($3::bigint IS NOT NULL AND mp.user_no = $3::bigint)
            OR (($3::bigint IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER($2))
          )
          AND NOT EXISTS (
            SELECT 1
            FROM solare_match_mode_proofs smp
            WHERE smp.region = mp.region
              AND smp.record_no = mp.record_no
              AND smp.mode = 'practice'
          )
      ),
      class_stats AS (
        SELECT
          class_type,
          skill_branch_type,
          COUNT(*)::int AS total_games,
          COUNT(*) FILTER (WHERE is_winner IS TRUE)::int AS wins,
          COUNT(*) FILTER (WHERE is_winner IS FALSE)::int AS losses,
          COALESCE(SUM(kill_count), 0)::bigint AS sum_kills,
          COALESCE(SUM(death_count), 0)::bigint AS sum_deaths,
          COALESCE(SUM(cc_applied_count), 0)::bigint AS sum_cc,
          COALESCE(SUM(damage_done), 0)::bigint AS sum_damage_done,
          COALESCE(SUM(damage_taken), 0)::bigint AS sum_damage_taken,
          COALESCE(SUM(recovery), 0)::bigint AS sum_recovery
        FROM
          season_matches
        GROUP BY
          class_type,
          skill_branch_type
      ),
      latest_identity AS (
        SELECT
          (SELECT user_nickname FROM season_matches ORDER BY record_no DESC LIMIT 1) AS latest_nickname,
          (SELECT user_no FROM season_matches WHERE user_no IS NOT NULL ORDER BY record_no DESC LIMIT 1) AS latest_user_no
      )
      SELECT
        cs.class_type,
        cs.skill_branch_type,
        cs.total_games,
        cs.wins,
        cs.losses,
        cs.sum_kills,
        cs.sum_deaths,
        cs.sum_cc,
        cs.sum_damage_done,
        cs.sum_damage_taken,
        cs.sum_recovery,
        li.latest_nickname,
        li.latest_user_no
      FROM
        latest_identity li
      LEFT JOIN
        class_stats cs ON true
      ORDER BY
        cs.total_games DESC NULLS LAST,
        cs.wins DESC NULLS LAST,
        cs.class_type ASC NULLS LAST,
        cs.skill_branch_type ASC NULLS LAST
      ;`,
    values: [targetRegion, targetNick, resolvedUserNo, targetSeason],
  });

  const statRows = summaryStatsResult.rows;
  const latestNickname = statRows[0]?.latest_nickname || null;
  const latestUserNo = statRows[0]?.latest_user_no || null;
  const classRows = statRows.filter(
    (r) => r.class_type !== null && r.class_type !== undefined,
  );

  let totalSeasonMatches = 0;
  let matchWins = 0;
  let matchLosses = 0;
  let sumKills = 0;
  let sumDeaths = 0;
  let sumCc = 0;
  let sumDamageDone = 0;
  let sumDamageTaken = 0;
  let sumRecovery = 0;

  const classes = classRows.map((c) => {
    const cGames = Number(c.total_games || 0);
    const cWins = Number(c.wins || 0);
    const cLosses = Number(c.losses || 0);
    const cKills = Number(c.sum_kills || 0);
    const cDeaths = Number(c.sum_deaths || 0);
    const cCc = Number(c.sum_cc || 0);
    const cDmgDone = Number(c.sum_damage_done || 0);
    const cDmgTaken = Number(c.sum_damage_taken || 0);
    const cRecovery = Number(c.sum_recovery || 0);

    totalSeasonMatches += cGames;
    matchWins += cWins;
    matchLosses += cLosses;
    sumKills += cKills;
    sumDeaths += cDeaths;
    sumCc += cCc;
    sumDamageDone += cDmgDone;
    sumDamageTaken += cDmgTaken;
    sumRecovery += cRecovery;

    return {
      class_type: Number(c.class_type),
      skill_branch_type: Number(c.skill_branch_type),
      wins: cWins,
      losses: cLosses,
      draws: 0,
      total_games: cGames,
      winrate: cGames > 0 ? Number(((cWins / cGames) * 100).toFixed(1)) : 0,
      averages: {
        kills: cGames > 0 ? Number((cKills / cGames).toFixed(1)) : 0,
        deaths: cGames > 0 ? Number((cDeaths / cGames).toFixed(1)) : 0,
        cc: cGames > 0 ? Number((cCc / cGames).toFixed(1)) : 0,
        damage_done: cGames > 0 ? Math.round(cDmgDone / cGames) : 0,
        damage_taken: cGames > 0 ? Math.round(cDmgTaken / cGames) : 0,
        recovery: cGames > 0 ? Math.round(cRecovery / cGames) : 0,
      },
    };
  });

  const hasSeasonMatches = totalSeasonMatches > 0;

  const isPlayerRowForTargetSeason =
    playerRow &&
    (Number(playerRow.season) === targetSeason ||
      (targetSeason === 9 &&
        (playerRow.season === null || playerRow.season === undefined)));

  const overallWins = isPlayerRowForTargetSeason
    ? Number(playerRow.win_count)
    : matchWins;
  const overallLosses = isPlayerRowForTargetSeason
    ? Number(playerRow.lose_count)
    : matchLosses;
  const overallDraws = isPlayerRowForTargetSeason
    ? Number(playerRow.draw_count)
    : 0;
  const overallTotalGames = overallWins + overallLosses + overallDraws;
  const overallWinrate =
    overallTotalGames > 0
      ? Number(((overallWins / overallTotalGames) * 100).toFixed(1))
      : 0;

  const canonicalNick =
    playerRow?.user_nickname ||
    latestNickname ||
    identityNickname ||
    targetNick;
  const canonicalUserNo =
    playerRow?.user_no || latestUserNo || resolvedUserNo || null;
  const primaryClassType =
    classes[0]?.class_type ??
    (isPlayerRowForTargetSeason ? playerRow.class_type : null) ??
    playerRow?.class_type ??
    null;
  const primarySkillBranchType =
    classes[0]?.skill_branch_type ??
    (isPlayerRowForTargetSeason ? playerRow.skill_branch_type : null) ??
    playerRow?.skill_branch_type ??
    null;

  const { activeCurrentRanking, activeOfficialRanking, activeClassRanking } =
    await resolvePlayerRankingPositions({
      isPlayerRowForTargetSeason,
      playerRow,
      targetRegion,
      targetSeason,
      canonicalUserNo,
      canonicalNick,
    });

  const activeRankRating =
    isPlayerRowForTargetSeason &&
    playerRow?.rank_rating !== null &&
    playerRow?.rank_rating !== undefined &&
    (playerRow.current_ranking !== null || !playerRow.rating_is_estimated)
      ? Number(playerRow.rank_rating)
      : null;

  return {
    region: targetRegion,
    season: targetSeason,
    user_nickname: canonicalNick,
    user_no: canonicalUserNo ? String(canonicalUserNo) : null,
    current_ranking: activeCurrentRanking,
    official_ranking: activeOfficialRanking,
    class_ranking: activeClassRanking,
    rank_rating: activeRankRating,
    rating_is_estimated: Boolean(
      isPlayerRowForTargetSeason && playerRow?.rating_is_estimated,
    ),
    class_type: primaryClassType !== null ? Number(primaryClassType) : null,
    skill_branch_type:
      primarySkillBranchType !== null ? Number(primarySkillBranchType) : null,
    kd_ratio: hasSeasonMatches
      ? sumDeaths > 0
        ? Number((sumKills / sumDeaths).toFixed(2))
        : Number((sumKills / totalSeasonMatches).toFixed(2))
      : null,
    overall: {
      wins: overallWins,
      losses: overallLosses,
      draws: overallDraws,
      total_games: overallTotalGames,
      winrate: overallWinrate,
    },
    averages: {
      kills: hasSeasonMatches
        ? Number((sumKills / totalSeasonMatches).toFixed(1))
        : 0,
      deaths: hasSeasonMatches
        ? Number((sumDeaths / totalSeasonMatches).toFixed(1))
        : 0,
      cc: hasSeasonMatches
        ? Number((sumCc / totalSeasonMatches).toFixed(1))
        : 0,
      damage_done: hasSeasonMatches
        ? Math.round(sumDamageDone / totalSeasonMatches)
        : 0,
      damage_taken: hasSeasonMatches
        ? Math.round(sumDamageTaken / totalSeasonMatches)
        : 0,
      recovery: hasSeasonMatches
        ? Math.round(sumRecovery / totalSeasonMatches)
        : 0,
    },
    classes,
  };
}

async function getPlayerProfile({
  nick,
  region,
  countryCode,
  season,
  class_type: classTypeFilter,
  page,
  limit,
} = {}) {
  const targetNick = validateNick(nick);
  const fallbackRegion = inferRegionFromCountry(countryCode);
  const targetRegion = validateRegion(region, fallbackRegion);
  const requestedSeason = validateSeason(season);
  const validatedClassType = validateClassType(classTypeFilter);
  const currentPage = validatePage(page);
  const pageSize = validateLimit(limit);

  const { playerRow, resolvedUserNo, identityNickname, targetSeason } =
    await resolvePlayerIdentityAndSeason({
      targetNick,
      targetRegion,
      requestedSeason,
    });

  const seasonMatchesResult = await database.query({
    text: `
      SELECT
        mp.id,
        mp.record_no,
        mp.team,
        mp.user_nickname,
        mp.user_no,
        mp.class_type,
        mp.skill_branch_type,
        mp.is_winner,
        mp.vary_rank_rating,
        mp.kill_count,
        mp.death_count,
        mp.cc_applied_count,
        mp.damage_done,
        mp.damage_taken,
        mp.recovery,
        m.season,
        m.play_time_seconds,
        m.win_record,
        m.repz_download_url,
        COALESCE(m.match_date, m.crawled_at, mp.created_at) AS match_date
      FROM
        solare_match_players mp
      INNER JOIN
        solare_matches m
        ON m.region = mp.region AND m.record_no = mp.record_no
      WHERE
        mp.region = $1
        AND (
          m.season = $4
          OR ($4 = 9 AND m.season IS NULL)
        )
        AND (
          ($3::bigint IS NOT NULL AND mp.user_no = $3::bigint)
          OR (($3::bigint IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER($2))
        )
        AND NOT EXISTS (
          SELECT 1
          FROM solare_match_mode_proofs smp
          WHERE smp.region = mp.region
            AND smp.record_no = mp.record_no
            AND smp.mode = 'practice'
        )
      ORDER BY
        mp.record_no DESC
      ;`,
    values: [targetRegion, targetNick, resolvedUserNo, targetSeason],
  });

  const seasonMatchRows = seasonMatchesResult.rows;
  const totalSeasonMatches = seasonMatchRows.length;
  const hasSeasonMatches = totalSeasonMatches > 0;
  const latestMatchRow = hasSeasonMatches ? seasonMatchRows[0] : null;

  let matchWins = 0;
  let matchLosses = 0;
  let sumKills = 0;
  let sumDeaths = 0;
  let sumCc = 0;
  let sumDamageDone = 0;
  let sumDamageTaken = 0;
  let sumRecovery = 0;
  let latestUserNo = null;
  let bestWinStreak = 0;
  let runningWinStreak = 0;

  for (let i = totalSeasonMatches - 1; i >= 0; i -= 1) {
    if (seasonMatchRows[i].is_winner === true) {
      runningWinStreak += 1;
      if (runningWinStreak > bestWinStreak) {
        bestWinStreak = runningWinStreak;
      }
    } else {
      runningWinStreak = 0;
    }
  }
  const currentWinStreak = runningWinStreak;

  const recentPdlDeltas = seasonMatchRows
    .slice(0, 20)
    .reverse()
    .map((r) =>
      r.vary_rank_rating !== null && r.vary_rank_rating !== undefined
        ? Number(r.vary_rank_rating)
        : 0,
    );

  const classMap = new Map();

  for (let i = 0; i < totalSeasonMatches; i += 1) {
    const row = seasonMatchRows[i];
    if (
      latestUserNo === null &&
      row.user_no !== null &&
      row.user_no !== undefined
    ) {
      latestUserNo = row.user_no;
    }

    const isWin = row.is_winner === true;
    const isLoss = row.is_winner === false;
    const kills = Number(row.kill_count || 0);
    const deaths = Number(row.death_count || 0);
    const cc = Number(row.cc_applied_count || 0);
    const dmgDone = Number(row.damage_done || 0);
    const dmgTaken = Number(row.damage_taken || 0);
    const heal = Number(row.recovery || 0);

    if (isWin) matchWins += 1;
    else if (isLoss) matchLosses += 1;

    sumKills += kills;
    sumDeaths += deaths;
    sumCc += cc;
    sumDamageDone += dmgDone;
    sumDamageTaken += dmgTaken;
    sumRecovery += heal;

    const cType = Number(row.class_type);
    const sBranch = Number(row.skill_branch_type);
    const classKey = `${cType}:${sBranch}`;

    if (!classMap.has(classKey)) {
      classMap.set(classKey, {
        class_type: cType,
        skill_branch_type: sBranch,
        wins: 0,
        losses: 0,
        draws: 0,
        total_games: 0,
        sumKills: 0,
        sumDeaths: 0,
        sumCc: 0,
        sumDamageDone: 0,
        sumDamageTaken: 0,
        sumRecovery: 0,
      });
    }

    const entry = classMap.get(classKey);
    if (isWin) entry.wins += 1;
    else if (isLoss) entry.losses += 1;
    entry.total_games += 1;
    entry.sumKills += kills;
    entry.sumDeaths += deaths;
    entry.sumCc += cc;
    entry.sumDamageDone += dmgDone;
    entry.sumDamageTaken += dmgTaken;
    entry.sumRecovery += heal;
  }

  const classes = Array.from(classMap.values())
    .sort(
      (a, b) =>
        b.total_games - a.total_games ||
        b.wins - a.wins ||
        a.class_type - b.class_type ||
        a.skill_branch_type - b.skill_branch_type,
    )
    .map((c) => ({
      class_type: c.class_type,
      skill_branch_type: c.skill_branch_type,
      wins: c.wins,
      losses: c.losses,
      draws: c.draws,
      total_games: c.total_games,
      winrate:
        c.total_games > 0
          ? Number(((c.wins / c.total_games) * 100).toFixed(1))
          : 0,
      averages: {
        kills:
          c.total_games > 0
            ? Number((c.sumKills / c.total_games).toFixed(1))
            : 0,
        deaths:
          c.total_games > 0
            ? Number((c.sumDeaths / c.total_games).toFixed(1))
            : 0,
        cc:
          c.total_games > 0 ? Number((c.sumCc / c.total_games).toFixed(1)) : 0,
        damage_done:
          c.total_games > 0 ? Math.round(c.sumDamageDone / c.total_games) : 0,
        damage_taken:
          c.total_games > 0 ? Math.round(c.sumDamageTaken / c.total_games) : 0,
        recovery:
          c.total_games > 0 ? Math.round(c.sumRecovery / c.total_games) : 0,
      },
    }));

  const isPlayerRowForTargetSeason =
    playerRow &&
    (Number(playerRow.season) === targetSeason ||
      (targetSeason === 9 &&
        (playerRow.season === null || playerRow.season === undefined)));

  const overallWins = isPlayerRowForTargetSeason
    ? Number(playerRow.win_count)
    : matchWins;
  const overallLosses = isPlayerRowForTargetSeason
    ? Number(playerRow.lose_count)
    : matchLosses;
  const overallDraws = isPlayerRowForTargetSeason
    ? Number(playerRow.draw_count)
    : 0;
  const overallTotalGames = overallWins + overallLosses + overallDraws;
  const overallWinrate =
    overallTotalGames > 0
      ? Number(((overallWins / overallTotalGames) * 100).toFixed(1))
      : 0;

  const canonicalNick =
    playerRow?.user_nickname ||
    latestMatchRow?.user_nickname ||
    identityNickname ||
    targetNick;
  const canonicalUserNo =
    playerRow?.user_no || latestUserNo || resolvedUserNo || null;
  const primaryClassType =
    classes[0]?.class_type ??
    (isPlayerRowForTargetSeason ? playerRow.class_type : null) ??
    playerRow?.class_type ??
    null;
  const primarySkillBranchType =
    classes[0]?.skill_branch_type ??
    (isPlayerRowForTargetSeason ? playerRow.skill_branch_type : null) ??
    playerRow?.skill_branch_type ??
    null;

  const filteredMatchRows =
    validatedClassType !== null
      ? seasonMatchRows.filter(
          (r) => Number(r.class_type) === validatedClassType,
        )
      : seasonMatchRows;

  const totalFilteredMatches = filteredMatchRows.length;
  const totalPages =
    totalFilteredMatches > 0 ? Math.ceil(totalFilteredMatches / pageSize) : 0;
  const startIndex = (currentPage - 1) * pageSize;
  const pageMatchRows = filteredMatchRows.slice(
    startIndex,
    startIndex + pageSize,
  );

  let matches = [];

  if (pageMatchRows.length > 0) {
    const pageRecordNos = pageMatchRows.map((r) => Number(r.record_no));

    const participantsResult = await database.query({
      text: `
        SELECT
          mp.id,
          mp.record_no,
          mp.team,
          mp.user_nickname,
          mp.user_no,
          mp.class_type,
          mp.skill_branch_type,
          mp.kill_count,
          mp.death_count,
          mp.cc_applied_count,
          mp.damage_done,
          mp.damage_taken,
          mp.recovery,
          mp.is_winner,
          mp.vary_rank_rating
        FROM
          solare_match_players mp
        WHERE
          mp.region = $1
          AND mp.record_no = ANY($2::bigint[])
        ORDER BY
          mp.record_no DESC,
          mp.id ASC
        ;`,
      values: [targetRegion, pageRecordNos],
    });

    const participantsByRecordNo = new Map();
    for (const pRow of participantsResult.rows) {
      const recNo = Number(pRow.record_no);
      if (!participantsByRecordNo.has(recNo)) {
        participantsByRecordNo.set(recNo, []);
      }
      participantsByRecordNo.get(recNo).push(pRow);
    }

    matches = pageMatchRows.map((myRow) => {
      const recNo = Number(myRow.record_no);
      const myTeam = Number(myRow.team);
      const allParticipants = participantsByRecordNo.get(recNo) || [];

      const allies = allParticipants
        .filter((p) => Number(p.team) === myTeam)
        .map(formatMatchParticipant);
      const enemies = allParticipants
        .filter((p) => Number(p.team) !== myTeam)
        .map(formatMatchParticipant);

      return {
        record_no: recNo,
        season: Number(myRow.season || targetSeason),
        match_date: myRow.match_date
          ? new Date(myRow.match_date).toISOString()
          : null,
        play_time_seconds: Number(myRow.play_time_seconds || 0),
        repz_download_url: myRow.repz_download_url || null,
        is_winner: Boolean(myRow.is_winner),
        vary_rank_rating:
          myRow.vary_rank_rating !== null &&
          myRow.vary_rank_rating !== undefined
            ? Number(myRow.vary_rank_rating)
            : null,
        win_record: normalizeWinRecord(myRow.win_record, myTeam),
        allies,
        enemies,
      };
    });
  }

  const { activeCurrentRanking, activeOfficialRanking, activeClassRanking } =
    await resolvePlayerRankingPositions({
      isPlayerRowForTargetSeason,
      playerRow,
      targetRegion,
      targetSeason,
      canonicalUserNo,
      canonicalNick,
    });

  const activeRankRating =
    isPlayerRowForTargetSeason &&
    playerRow?.rank_rating !== null &&
    playerRow?.rank_rating !== undefined &&
    (playerRow.current_ranking !== null || !playerRow.rating_is_estimated)
      ? Number(playerRow.rank_rating)
      : null;

  return {
    region: targetRegion,
    season: targetSeason,
    user_nickname: canonicalNick,
    user_no: canonicalUserNo ? String(canonicalUserNo) : null,
    current_ranking: activeCurrentRanking,
    official_ranking: activeOfficialRanking,
    class_ranking: activeClassRanking,
    rank_rating: activeRankRating,
    rating_is_estimated: Boolean(
      isPlayerRowForTargetSeason && playerRow?.rating_is_estimated,
    ),
    class_type: primaryClassType !== null ? Number(primaryClassType) : null,
    skill_branch_type:
      primarySkillBranchType !== null ? Number(primarySkillBranchType) : null,
    kd_ratio: hasSeasonMatches
      ? sumDeaths > 0
        ? Number((sumKills / sumDeaths).toFixed(2))
        : Number((sumKills / totalSeasonMatches).toFixed(2))
      : null,
    overall: {
      wins: overallWins,
      losses: overallLosses,
      draws: overallDraws,
      total_games: overallTotalGames,
      winrate: overallWinrate,
      best_win_streak: bestWinStreak,
      current_win_streak: currentWinStreak,
    },
    recent_pdl_deltas: recentPdlDeltas,
    averages: {
      kills: hasSeasonMatches
        ? Number((sumKills / totalSeasonMatches).toFixed(1))
        : 0,
      deaths: hasSeasonMatches
        ? Number((sumDeaths / totalSeasonMatches).toFixed(1))
        : 0,
      cc: hasSeasonMatches
        ? Number((sumCc / totalSeasonMatches).toFixed(1))
        : 0,
      damage_done: hasSeasonMatches
        ? Math.round(sumDamageDone / totalSeasonMatches)
        : 0,
      damage_taken: hasSeasonMatches
        ? Math.round(sumDamageTaken / totalSeasonMatches)
        : 0,
      recovery: hasSeasonMatches
        ? Math.round(sumRecovery / totalSeasonMatches)
        : 0,
    },
    classes,
    pagination: {
      page: currentPage,
      limit: pageSize,
      total_matches: totalFilteredMatches,
      total_pages: totalPages,
      has_more: currentPage < totalPages,
    },
    matches,
  };
}

async function getRanking({ region, season, classType, headers } = {}) {
  const inferredRegion = inferRegionFromHeaders(headers);
  const targetRegion = validateRegion(region, inferredRegion);
  const requestedSeason = validateSeason(season);
  const validatedClassType = validateClassType(classType);

  let targetSeason = requestedSeason;
  if (targetSeason === null) {
    const seasonResult = await database.query({
      text: `
        SELECT
          MAX(season)::smallint AS latest_season
        FROM
          solare_players
        WHERE
          region = $1
        ;`,
      values: [targetRegion],
    });

    targetSeason = seasonResult.rows[0]?.latest_season
      ? Number(seasonResult.rows[0].latest_season)
      : 9;
  }

  // PA's GetRankList assigns a unique `_ranking` (1..998) to each active player; only 999 is a shared
  // floor bucket. The crawler never clears `current_ranking` for accounts that drop out of GetRankList
  // (banned/deleted/fell off), so a stale "ghost" row can keep an official rank that a newer player
  // now holds. Deduplicating by official rank (newest snapshot wins) drops those ghosts.
  const playersResult = await database.query({
    text: `
      WITH deduplicated_ranking AS (
        SELECT DISTINCT ON (
          CASE
            WHEN current_ranking IS NOT NULL AND current_ranking < ${SOLARE_SHARED_RANK_FLOOR} THEN 'r:' || current_ranking::text
            ELSE 'u:' || COALESCE(user_no::text, LOWER(user_nickname))
          END
        )
          user_no,
          user_nickname,
          current_ranking,
          rank_rating,
          rating_is_estimated,
          rating_achieved_record_no,
          class_type,
          skill_branch_type,
          win_count,
          lose_count,
          draw_count,
          updated_at,
          last_seen_at
        FROM
          solare_players
        WHERE
          region = $1
          AND (
            (current_ranking IS NOT NULL AND current_ranking >= 1)
            OR (rank_rating IS NOT NULL AND NOT COALESCE(rating_is_estimated, FALSE))
          )
          AND (
            season = $2
            OR ($2 = 9 AND season IS NULL)
          )
          AND NOT (
            current_ranking IS NULL
            AND EXISTS (
              SELECT 1
              FROM solare_players sp_dup
              WHERE sp_dup.region = solare_players.region
                AND (sp_dup.season = $2 OR ($2 = 9 AND sp_dup.season IS NULL))
                AND sp_dup.current_ranking IS NOT NULL
                AND sp_dup.current_ranking >= 1
                AND (
                  (solare_players.user_no IS NOT NULL AND sp_dup.user_no = solare_players.user_no)
                  OR (
                    (solare_players.user_no IS NULL OR sp_dup.user_no IS NULL)
                    AND LOWER(sp_dup.user_nickname) = LOWER(solare_players.user_nickname)
                  )
                )
            )
          )
        ORDER BY
          CASE
            WHEN current_ranking IS NOT NULL AND current_ranking < ${SOLARE_SHARED_RANK_FLOOR} THEN 'r:' || current_ranking::text
            ELSE 'u:' || COALESCE(user_no::text, LOWER(user_nickname))
          END ASC,
          COALESCE(last_seen_at, updated_at) DESC NULLS LAST,
          updated_at DESC NULLS LAST,
          win_count DESC
      ),
      ${RANKING_MOST_PLAYED_CLASS_CTES},
      ranking_with_most_played_class AS (
        SELECT
          rp.user_no,
          rp.user_nickname,
          rp.current_ranking,
          rp.rank_rating,
          rp.rating_is_estimated,
          rp.rating_achieved_record_no,
          COALESCE(mpc.class_type, rp.class_type)::smallint AS class_type,
          COALESCE(mpc.skill_branch_type, rp.skill_branch_type)::smallint AS skill_branch_type,
          rp.win_count,
          rp.lose_count,
          rp.draw_count,
          rp.updated_at
        FROM
          ranking_players rp
        LEFT JOIN
          most_played_class mpc ON mpc.dr_id = rp.dr_id
      ),
      ranked_with_class AS (
        SELECT
          user_no,
          user_nickname,
          current_ranking,
          CASE
            WHEN rank_rating IS NOT NULL THEN
              ROW_NUMBER() OVER (
                ORDER BY
                  CASE WHEN rank_rating IS NOT NULL THEN 0 ELSE 1 END ASC,
                  rank_rating DESC NULLS LAST,
                  current_ranking ASC NULLS LAST,
                  rating_achieved_record_no ASC NULLS LAST,
                  win_count DESC
              )::int
            ELSE current_ranking
          END AS effective_ranking,
          rank_rating,
          rating_is_estimated,
          rating_achieved_record_no,
          ROW_NUMBER() OVER (
            PARTITION BY class_type
            ORDER BY
              CASE WHEN rank_rating IS NOT NULL THEN 0 ELSE 1 END ASC,
              rank_rating DESC NULLS LAST,
              current_ranking ASC NULLS LAST,
              rating_achieved_record_no ASC NULLS LAST,
              win_count DESC
          )::int AS class_ranking,
          class_type,
          skill_branch_type,
          win_count,
          lose_count,
          draw_count,
          updated_at
        FROM
          ranking_with_most_played_class
      ),
      top_ranking AS (
        SELECT
          user_no,
          user_nickname,
          current_ranking,
          effective_ranking,
          class_ranking,
          rank_rating,
          rating_is_estimated,
          rating_achieved_record_no,
          class_type,
          skill_branch_type,
          win_count,
          lose_count,
          draw_count,
          updated_at
        FROM
          ranked_with_class
        WHERE
          ($3::smallint IS NULL OR class_type = $3::smallint)
          AND ($3::smallint IS NOT NULL OR effective_ranking <= 100)
        ORDER BY
          effective_ranking ASC NULLS LAST,
          rank_rating DESC NULLS LAST,
          current_ranking ASC NULLS LAST,
          rating_achieved_record_no ASC NULLS LAST
        LIMIT 100
      )
      SELECT
        tr.user_no,
        tr.user_nickname,
        tr.current_ranking,
        tr.effective_ranking,
        tr.class_ranking,
        tr.rank_rating,
        tr.rating_is_estimated,
        tr.rating_achieved_record_no,
        tr.class_type,
        tr.skill_branch_type,
        tr.win_count,
        tr.lose_count,
        tr.draw_count,
        tr.updated_at,
        ARRAY(
          SELECT
            mp.is_winner
          FROM
            solare_match_players mp
          INNER JOIN
            solare_matches m
            ON m.region = mp.region AND m.record_no = mp.record_no
          WHERE
            mp.region = $1
            AND (
              m.season = $2
              OR ($2 = 9 AND m.season IS NULL)
            )
            AND (
              (tr.user_no IS NOT NULL AND mp.user_no = tr.user_no)
              OR ((tr.user_no IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER(tr.user_nickname))
            )
            AND NOT EXISTS (
              SELECT 1
              FROM solare_match_mode_proofs smp
              WHERE smp.region = mp.region
                AND smp.record_no = mp.record_no
                AND smp.mode = 'practice'
            )
          ORDER BY
            mp.record_no DESC
          LIMIT 5
        ) AS recent_matches
      FROM
        top_ranking tr
      ORDER BY
        tr.effective_ranking ASC NULLS LAST,
        tr.rank_rating DESC NULLS LAST,
        tr.current_ranking ASC NULLS LAST,
        tr.rating_achieved_record_no ASC NULLS LAST
      ;`,
    values: [targetRegion, targetSeason, validatedClassType],
  });

  const players = playersResult.rows.map((p, index) => {
    const wins = Number(p.win_count || 0);
    const losses = Number(p.lose_count || 0);
    const draws = Number(p.draw_count || 0);
    const totalGames = wins + losses + draws;
    const winrate =
      totalGames > 0 ? Number(((wins / totalGames) * 100).toFixed(1)) : 0;

    return {
      rank:
        p.effective_ranking !== null && p.effective_ranking !== undefined
          ? Number(p.effective_ranking)
          : p.current_ranking !== null && p.current_ranking !== undefined
            ? Number(p.current_ranking)
            : index + 1,
      official_ranking:
        p.current_ranking !== null && p.current_ranking !== undefined
          ? Number(p.current_ranking)
          : null,
      class_ranking:
        p.class_ranking !== null && p.class_ranking !== undefined
          ? Number(p.class_ranking)
          : null,
      rank_rating:
        p.rank_rating !== null && p.rank_rating !== undefined
          ? Number(p.rank_rating)
          : null,
      rating_is_estimated: Boolean(p.rating_is_estimated),
      rating_achieved_record_no:
        p.rating_achieved_record_no !== null &&
        p.rating_achieved_record_no !== undefined
          ? Number(p.rating_achieved_record_no)
          : null,
      user_no: p.user_no ? String(p.user_no) : null,
      user_nickname: p.user_nickname,
      class_type: Number(p.class_type),
      skill_branch_type: Number(p.skill_branch_type),
      wins,
      losses,
      draws,
      total_games: totalGames,
      winrate,
      recent_matches: Array.isArray(p.recent_matches)
        ? p.recent_matches.map((w) => Boolean(w))
        : [],
      updated_at: p.updated_at ? new Date(p.updated_at).toISOString() : null,
    };
  });

  return {
    region: targetRegion,
    season: targetSeason,
    players,
  };
}

const SOLARE_STARTING_RATINGS = [401, 501, 601, 701, 801];

function getSeasonResetStartingRating(previousRating) {
  if (
    previousRating === null ||
    previousRating === undefined ||
    !Number.isFinite(Number(previousRating))
  ) {
    return 401;
  }

  const numericRating = Number(previousRating);

  if (numericRating >= 2101) {
    return 801;
  }

  if (numericRating >= 1801) {
    return 701;
  }

  if (numericRating >= 1501) {
    return 601;
  }

  if (numericRating >= 1201) {
    return 501;
  }

  return 401;
}

async function applyInactivityDecay({ region, season, now } = {}) {
  const targetRegion = region ? validateRegion(region) : null;
  const targetSeason = validateSeason(season);
  const referenceDate = now ? new Date(now) : new Date();

  if (Number.isNaN(referenceDate.getTime())) {
    throw new ValidationError({
      message: "Invalid 'now' timestamp provided for decay evaluation.",
      action: "Provide a valid ISO timestamp or Date instance.",
    });
  }

  const candidatesResult = await database.query({
    text: `
      SELECT
        sp.region,
        sp.season,
        sp.user_no,
        sp.user_nickname,
        sp.rank_rating,
        sp.last_decay_at,
        COALESCE(
          CASE
            WHEN latest_mp.raw_match_at IS NOT NULL THEN
              LEAST(
                latest_mp.raw_match_at,
                COALESCE(
                  (
                    SELECT MIN(m_next.match_date)
                    FROM (
                      SELECT m2.match_date
                      FROM solare_matches m2
                      WHERE m2.region = sp.region
                        AND m2.record_no > latest_mp.record_no
                        AND m2.match_date IS NOT NULL
                      ORDER BY m2.record_no ASC
                      LIMIT 25
                    ) m_next
                  ),
                  latest_mp.raw_match_at
                )
              )
            ELSE NULL
          END,
          sp.rating_achieved_at,
          sp.last_seen_at
        ) AS last_match_at,
        latest_decay.id AS latest_decay_event_id,
        latest_reset.id AS latest_reset_event_id,
        latest_reset.event_type AS latest_reset_event_type,
        latest_reset.created_at AS latest_reset_created_at,
        latest_reset.metadata->>'snapshot_date' AS seed_snapshot_date,
        COALESCE((latest_reset.metadata->>'extra_games_fast_forwarded')::int, 0) AS seed_extra_games
      FROM
        solare_players sp
      LEFT JOIN LATERAL (
        SELECT
          mp.record_no,
          COALESCE(m.match_date, m.crawled_at, mp.created_at) AS raw_match_at
        FROM solare_match_players mp
        LEFT JOIN solare_matches m
          ON m.region = mp.region AND m.record_no = mp.record_no
        WHERE
          mp.region = sp.region
          AND (
            ($2::smallint IS NULL OR m.season = $2::smallint OR ($2::smallint = 9 AND m.season IS NULL))
          )
          AND (
            (sp.user_no IS NOT NULL AND mp.user_no = sp.user_no)
            OR (sp.user_no IS NULL AND LOWER(mp.user_nickname) = LOWER(sp.user_nickname))
          )
          AND NOT EXISTS (
            SELECT 1
            FROM solare_match_mode_proofs smp
            WHERE smp.region = mp.region
              AND smp.record_no = mp.record_no
              AND smp.mode = 'practice'
          )
        ORDER BY mp.record_no DESC
        LIMIT 1
      ) latest_mp ON true
      LEFT JOIN LATERAL (
        SELECT ed.id
        FROM solare_player_rating_events ed
        WHERE ed.region = sp.region
          AND (
            (sp.user_no IS NOT NULL AND ed.user_no = sp.user_no)
            OR (sp.user_no IS NULL AND LOWER(ed.user_nickname) = LOWER(sp.user_nickname))
          )
          AND ed.event_type = 'decay'
        ORDER BY ed.id DESC
        LIMIT 1
      ) latest_decay ON true
      LEFT JOIN LATERAL (
        SELECT er.id, er.event_type, er.created_at, er.metadata
        FROM solare_player_rating_events er
        WHERE er.region = sp.region
          AND (
            (sp.user_no IS NOT NULL AND er.user_no = sp.user_no)
            OR (sp.user_no IS NULL AND LOWER(er.user_nickname) = LOWER(sp.user_nickname))
          )
          AND er.event_type IN ('season_reset', 'seed_anchor', 'inferred_start', 'reconcile')
        ORDER BY er.id DESC
        LIMIT 1
      ) latest_reset ON true
      WHERE
        sp.rank_rating IS NOT NULL
        AND NOT COALESCE(sp.rating_is_estimated, FALSE)
        AND sp.rank_rating >= 1801
        AND ($1::varchar IS NULL OR sp.region = $1::varchar)
        AND ($2::smallint IS NULL OR sp.season = $2::smallint OR ($2::smallint = 9 AND sp.season IS NULL))
      ;`,
    values: [targetRegion, targetSeason],
  });

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const decayedPlayers = [];

  for (const row of candidatesResult.rows) {
    if (!row.last_match_at) {
      continue;
    }

    const lastMatchMs = new Date(row.last_match_at).getTime();
    const rawLastDecayMs = row.last_decay_at
      ? new Date(row.last_decay_at).getTime()
      : null;
    const nowMs = referenceDate.getTime();

    if (nowMs <= lastMatchMs) {
      continue;
    }

    let currentRating = Number(row.rank_rating);
    const graceDays = currentRating >= 2101 ? 2 : 3;
    const intervalDays = currentRating >= 2101 ? 1 : 2;
    const penaltyPerInterval =
      currentRating >= 2401 ? 50 : currentRating >= 2101 ? 40 : 30;

    const firstDecayThresholdMs = lastMatchMs + graceDays * MS_PER_DAY;
    if (nowMs < firstDecayThresholdMs) {
      continue;
    }

    let lastDecayMs = rawLastDecayMs;
    const latestResetId = Number(row.latest_reset_event_id || 0);
    const latestDecayId = Number(row.latest_decay_event_id || 0);

    if (latestResetId > latestDecayId) {
      if (
        row.latest_reset_event_type === "seed_anchor" &&
        Number(row.seed_extra_games || 0) === 0 &&
        row.seed_snapshot_date
      ) {
        const snapshotMs = new Date(row.seed_snapshot_date).getTime();
        lastDecayMs =
          !Number.isNaN(snapshotMs) && snapshotMs >= firstDecayThresholdMs
            ? snapshotMs
            : null;
      } else if (
        row.latest_reset_event_type === "inferred_start" ||
        row.latest_reset_event_type === "season_reset"
      ) {
        lastDecayMs = null;
      } else if (
        row.latest_reset_event_type === "reconcile" &&
        row.latest_reset_created_at
      ) {
        const reconcileMs = new Date(row.latest_reset_created_at).getTime();
        if (!Number.isNaN(reconcileMs)) {
          lastDecayMs =
            rawLastDecayMs !== null
              ? Math.max(rawLastDecayMs, reconcileMs)
              : reconcileMs;
        }
      }
    }

    let intervalsToApply;
    let nextDecayWatermarkMs = lastDecayMs;

    if (lastDecayMs === null || lastDecayMs < firstDecayThresholdMs) {
      const elapsedAfterThresholdMs = nowMs - firstDecayThresholdMs;
      intervalsToApply =
        1 + Math.floor(elapsedAfterThresholdMs / (intervalDays * MS_PER_DAY));
      nextDecayWatermarkMs =
        firstDecayThresholdMs +
        (intervalsToApply - 1) * intervalDays * MS_PER_DAY;
    } else {
      const elapsedSinceLastDecayMs = nowMs - lastDecayMs;
      intervalsToApply = Math.floor(
        elapsedSinceLastDecayMs / (intervalDays * MS_PER_DAY),
      );
      if (intervalsToApply > 0) {
        nextDecayWatermarkMs =
          lastDecayMs + intervalsToApply * intervalDays * MS_PER_DAY;
      }
    }

    if (intervalsToApply <= 0) {
      continue;
    }

    const rawDelta = -(intervalsToApply * penaltyPerInterval);
    const newRating = Math.max(1800, currentRating + rawDelta);
    const appliedDelta = newRating - currentRating;

    if (appliedDelta === 0) {
      continue;
    }

    const nextDecayWatermarkIso = new Date(nextDecayWatermarkMs).toISOString();

    await database.query({
      text: `
        WITH updated_player AS (
          UPDATE solare_players
          SET
            rank_rating = $3,
            last_decay_at = $4::timestamptz,
            updated_at = timezone('utc', now())
          WHERE region = $1 AND user_no = $2
          RETURNING region, season, user_no, user_nickname
        )
        INSERT INTO solare_player_rating_events (
          region,
          season,
          user_no,
          user_nickname,
          event_type,
          previous_rating,
          rating_delta,
          new_rating
        )
        SELECT
          up.region,
          up.season,
          up.user_no,
          up.user_nickname,
          'decay',
          $5,
          $6,
          $3
        FROM updated_player up
        ;`,
      values: [
        row.region,
        row.user_no,
        newRating,
        nextDecayWatermarkIso,
        currentRating,
        appliedDelta,
      ],
    });

    decayedPlayers.push({
      region: row.region,
      user_nickname: row.user_nickname,
      rating_before: currentRating,
      rating_delta: appliedDelta,
      rating_after: newRating,
      last_decay_at: nextDecayWatermarkIso,
    });
  }

  return {
    decayedCount: decayedPlayers.length,
    players: decayedPlayers,
  };
}

async function reconcileRegionRatings({
  region,
  season,
  anchors = [],
  autoClamp = false,
} = {}) {
  const targetRegion = validateRegion(region);
  const targetSeason = validateSeason(season) ?? 9;

  let reconciledCount = 0;

  if (Array.isArray(anchors) && anchors.length > 0) {
    for (const anchor of anchors) {
      if (
        !anchor ||
        !anchor.user_nickname ||
        !Number.isFinite(Number(anchor.rank_rating))
      ) {
        continue;
      }

      const targetRating = Math.max(0, Math.round(Number(anchor.rank_rating)));
      const anchorRecordNo =
        anchor.record_no !== null && anchor.record_no !== undefined
          ? Number(anchor.record_no)
          : null;

      const existingResult = await database.query({
        text: `
          SELECT
            region,
            user_no,
            user_nickname,
            rank_rating,
            rating_is_estimated,
            rating_anchor_record_no,
            COALESCE(
              (
                SELECT MAX(mp.record_no)
                FROM solare_match_players mp
                WHERE
                  mp.region = solare_players.region
                  AND (
                    (solare_players.user_no IS NOT NULL AND mp.user_no = solare_players.user_no)
                    OR ((solare_players.user_no IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER(solare_players.user_nickname))
                  )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM solare_match_mode_proofs smp
                    WHERE smp.region = mp.region
                      AND smp.record_no = mp.record_no
                      AND smp.mode = 'practice'
                  )
              ),
              0
            ) AS latest_record_no
          FROM
            solare_players
          WHERE
            region = $1
            AND LOWER(user_nickname) = LOWER($2)
            AND (season = $3 OR ($3 = 9 AND season IS NULL))
          ORDER BY
            current_ranking ASC NULLS LAST,
            updated_at DESC
          LIMIT 1
          ;`,
        values: [
          targetRegion,
          String(anchor.user_nickname).trim(),
          targetSeason,
        ],
      });

      if (existingResult.rowCount === 0) {
        continue;
      }

      const row = existingResult.rows[0];
      const ratingBefore =
        row.rank_rating !== null && row.rank_rating !== undefined
          ? Number(row.rank_rating)
          : null;

      if (
        ratingBefore === targetRating &&
        !row.rating_is_estimated &&
        row.rating_anchor_record_no !== null
      ) {
        continue;
      }

      const effectiveRecordNo =
        anchorRecordNo !== null
          ? anchorRecordNo
          : Number(row.latest_record_no) > 0
            ? Number(row.latest_record_no)
            : null;
      const delta =
        ratingBefore !== null ? targetRating - ratingBefore : targetRating;

      await database.query({
        text: `
          WITH updated_player AS (
            UPDATE solare_players
            SET
              rank_rating = $3,
              rating_is_estimated = FALSE,
              rating_anchor_record_no = $4,
              rating_achieved_record_no = $4,
              rating_achieved_at = timezone('utc', now()),
              updated_at = timezone('utc', now())
            WHERE region = $1 AND user_no = $2
            RETURNING region, season, user_no, user_nickname
          )
          INSERT INTO solare_player_rating_events (
            region,
            season,
            user_no,
            user_nickname,
            record_no,
            event_type,
            previous_rating,
            rating_delta,
            new_rating
          )
          SELECT
            up.region,
            up.season,
            up.user_no,
            up.user_nickname,
            $4,
            'reconcile',
            $5,
            $6,
            $3
          FROM updated_player up
          ;`,
        values: [
          row.region,
          row.user_no,
          targetRating,
          effectiveRecordNo,
          ratingBefore,
          delta,
        ],
      });

      reconciledCount += 1;
    }
  }

  const runUnseededInferencePass = async () => {
    const passResult = await database.query({
      text: `
        SELECT
          ARRAY_AGG(
            COALESCE(ordered.user_no::text, LOWER(ordered.user_nickname))
          ) FILTER (
            WHERE fn_infer_unseeded_solare_player_rating(
              ordered.region,
              ordered.user_no,
              ordered.user_nickname
            )
          ) AS inferred_keys
        FROM (
          SELECT
            region,
            user_no,
            user_nickname
          FROM solare_players
          WHERE region = $1
            AND rating_anchor_record_no IS NULL
            AND current_ranking IS NOT NULL
            AND current_ranking >= 1
            AND (season = $2 OR ($2 = 9 AND season IS NULL))
            AND (
              rank_rating IS NULL
              OR rating_is_estimated = TRUE
              OR EXISTS (
                SELECT 1
                FROM solare_player_rating_events e
                WHERE e.region = solare_players.region
                  AND e.user_no = solare_players.user_no
                  AND e.event_type = 'inferred_start'
                  AND COALESCE(e.season, 9) = COALESCE(solare_players.season, 9)
                  AND e.id > COALESCE((
                    SELECT MAX(ep.id)
                    FROM solare_player_rating_events ep
                    WHERE ep.region = solare_players.region
                      AND ep.user_no = solare_players.user_no
                      AND ep.event_type IN ('season_reset', 'seed_anchor', 'reconcile', 'decay')
                  ), 0)
              )
            )
          ORDER BY
            current_ranking ASC,
            updated_at DESC
        ) ordered
        ;`,
      values: [targetRegion, targetSeason],
    });

    return passResult.rows[0]?.inferred_keys || [];
  };

  if (autoClamp) {
    // Clear stale "ghost" official ranks where a newer snapshot holds the same rank (< 999)
    // before running unseeded neighbor inference.
    await database.query({
      text: `
        WITH active_holders AS (
          SELECT DISTINCT ON (current_ranking)
            user_no,
            user_nickname,
            current_ranking
          FROM solare_players
          WHERE region = $1
            AND current_ranking IS NOT NULL
            AND current_ranking >= 1
            AND current_ranking < ${SOLARE_SHARED_RANK_FLOOR}
            AND (season = $2 OR ($2 = 9 AND season IS NULL))
          ORDER BY
            current_ranking ASC,
            COALESCE(last_seen_at, updated_at) DESC NULLS LAST,
            updated_at DESC NULLS LAST,
            win_count DESC
        )
        UPDATE solare_players sp
        SET
          current_ranking = NULL,
          rank_rating = CASE WHEN COALESCE(sp.rating_is_estimated, FALSE) THEN NULL ELSE sp.rank_rating END,
          rating_is_estimated = FALSE,
          updated_at = timezone('utc', now())
        FROM active_holders ah
        WHERE sp.region = $1
          AND (sp.season = $2 OR ($2 = 9 AND sp.season IS NULL))
          AND sp.current_ranking = ah.current_ranking
          AND (
            (sp.user_no IS NOT NULL AND ah.user_no IS NOT NULL AND sp.user_no <> ah.user_no)
            OR ((sp.user_no IS NULL OR ah.user_no IS NULL) AND LOWER(sp.user_nickname) <> LOWER(ah.user_nickname))
          )
        ;`,
      values: [targetRegion, targetSeason],
    });
  }

  // 1. Infer clean unseeded players first to tighten neighbor brackets
  const inferredSet = new Set(await runUnseededInferencePass());

  // 2. Prove Ranked vs Practice matches mathematically across the entire region
  const proofStats = await proveRegionMatchModes({
    region: targetRegion,
    season: targetSeason,
  });

  // 3. Re-infer unseeded/estimated players using newly proven Practice exclusions & neighbor bounds
  for (const key of await runUnseededInferencePass()) {
    inferredSet.add(key);
  }
  for (const key of await runUnseededInferencePass()) {
    inferredSet.add(key);
  }

  const inferredCount = inferredSet.size;
  reconciledCount += inferredCount;

  const leaderboardResult = await database.query({
    text: `
      SELECT DISTINCT ON (sp.current_ranking)
        sp.region,
        sp.user_no,
        sp.user_nickname,
        sp.current_ranking,
        sp.rank_rating,
        sp.rating_achieved_record_no,
        (
          sp.last_seen_at IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM solare_match_players mp_post
            INNER JOIN solare_matches m_post
              ON m_post.region = mp_post.region AND m_post.record_no = mp_post.record_no
            LEFT JOIN solare_match_mode_proofs pr_post
              ON pr_post.region = mp_post.region AND pr_post.record_no = mp_post.record_no
            WHERE mp_post.region = sp.region
              AND COALESCE(pr_post.mode, '') <> 'practice'
              AND COALESCE(m_post.season, 9) = COALESCE(sp.season, $2)
              AND (
                (sp.user_no IS NOT NULL AND mp_post.user_no = sp.user_no)
                OR ((sp.user_no IS NULL OR mp_post.user_no IS NULL) AND LOWER(mp_post.user_nickname) = LOWER(sp.user_nickname))
              )
              AND m_post.match_date IS NOT NULL
              AND m_post.match_date > sp.last_seen_at + INTERVAL '10 seconds'
          )
        ) AS has_post_snapshot_match
      FROM
        solare_players sp
      WHERE
        sp.region = $1
        AND sp.current_ranking IS NOT NULL
        AND sp.current_ranking >= 1
        AND (sp.season = $2 OR ($2 = 9 AND sp.season IS NULL))
      ORDER BY
        sp.current_ranking ASC,
        COALESCE(sp.last_seen_at, sp.updated_at) DESC NULLS LAST,
        sp.updated_at DESC NULLS LAST
      ;`,
    values: [targetRegion, targetSeason],
  });

  const discrepancies = [];
  const rows = leaderboardResult.rows.filter(
    (row) =>
      row.rank_rating !== null &&
      row.rank_rating !== undefined &&
      !row.has_post_snapshot_match,
  );

  if (autoClamp) {
    const outliers = planMonotonicRatingReconciliation(rows);
    for (const outlier of outliers) {
      const targetRow = outlier.row;
      const previousRating = Number(outlier.rating);
      const clampedRating = Number(outlier.targetRating);
      const delta = clampedRating - previousRating;

      await database.query({
        text: `
          WITH updated_player AS (
            UPDATE solare_players
            SET
              rank_rating = $3,
              rating_is_estimated = FALSE,
              updated_at = timezone('utc', now())
            WHERE region = $1 AND user_no = $2
            RETURNING region, season, user_no, user_nickname, rating_achieved_record_no
          )
          INSERT INTO solare_player_rating_events (
            region,
            season,
            user_no,
            user_nickname,
            record_no,
            event_type,
            previous_rating,
            rating_delta,
            new_rating,
            metadata
          )
          SELECT
            up.region,
            up.season,
            up.user_no,
            up.user_nickname,
            up.rating_achieved_record_no,
            'reconcile',
            $4,
            $5,
            $3,
            jsonb_build_object(
              'reason', 'daily_ranking_clamp',
              'current_ranking', $6::int,
              'upper_rank', $7::int,
              'upper_rating', $8::int,
              'lower_rank', $9::int,
              'lower_rating', $10::int
            )
          FROM updated_player up
          ;`,
        values: [
          targetRow.region,
          targetRow.user_no,
          clampedRating,
          previousRating,
          delta,
          Number(targetRow.current_ranking),
          outlier.upper ? Number(outlier.upper.current_ranking) : null,
          outlier.upper ? Number(outlier.upper.rank_rating) : null,
          outlier.lower ? Number(outlier.lower.current_ranking) : null,
          outlier.lower ? Number(outlier.lower.rank_rating) : null,
        ],
      });

      reconciledCount += 1;
    }
  } else {
    for (let i = 0; i < rows.length - 1; i += 1) {
      const higherRanked = rows[i];
      const lowerRanked = rows[i + 1];
      const higherRating = Number(higherRanked.rank_rating);
      const lowerRating = Number(lowerRanked.rank_rating);

      if (higherRating < lowerRating) {
        discrepancies.push({
          higher_rank: Number(higherRanked.current_ranking),
          higher_nick: higherRanked.user_nickname,
          higher_rating: higherRating,
          lower_rank: Number(lowerRanked.current_ranking),
          lower_nick: lowerRanked.user_nickname,
          lower_rating: lowerRating,
        });
      }
    }
  }

  return {
    region: targetRegion,
    season: targetSeason,
    reconciledCount,
    inferredCount,
    provenRanked: proofStats.provenRanked,
    provenPractice: proofStats.provenPractice,
    discrepancies,
  };
}

async function resetSeasonRatings({ region, fromSeason, toSeason } = {}) {
  const targetRegion = region ? validateRegion(region) : null;
  const validatedFromSeason = validateSeason(fromSeason);
  const validatedToSeason = validateSeason(toSeason);

  if (validatedToSeason === null) {
    throw new ValidationError({
      message: '"toSeason" is required when resetting season ratings.',
      action: "Provide a valid target season number.",
    });
  }

  const result = await database.query({
    text: `
      WITH cleared_checkpoints AS (
        DELETE FROM solare_player_wl_checkpoints
        WHERE ($1::varchar IS NULL OR region = $1::varchar)
          AND (
            $2::smallint IS NULL
            OR season = $2::smallint
            OR season = $3::smallint
          )
      ),
      target_players AS (
        SELECT
          region,
          user_no,
          user_nickname,
          rank_rating AS rating_before,
          CASE
            WHEN rank_rating >= 2101 THEN 801
            WHEN rank_rating >= 1801 THEN 701
            WHEN rank_rating >= 1501 THEN 601
            WHEN rank_rating >= 1201 THEN 501
            ELSE 401
          END AS rating_after
        FROM
          solare_players
        WHERE
          ($1::varchar IS NULL OR region = $1::varchar)
          AND ($2::smallint IS NULL OR season = $2::smallint OR ($2::smallint = 9 AND season IS NULL))
      ),
      updated_players AS (
        UPDATE solare_players sp
        SET
          season = $3::smallint,
          rank_rating = tp.rating_after,
          rating_is_estimated = FALSE,
          rating_anchor_record_no = NULL,
          rating_achieved_record_no = NULL,
          rating_achieved_at = timezone('utc', now()),
          last_decay_at = NULL,
          updated_at = timezone('utc', now())
        FROM target_players tp
        WHERE sp.region = tp.region AND sp.user_no = tp.user_no
        RETURNING
          sp.region,
          sp.season,
          sp.user_no,
          sp.user_nickname,
          tp.rating_before,
          tp.rating_after
      ),
      inserted_events AS (
        INSERT INTO solare_player_rating_events (
          region,
          season,
          user_no,
          user_nickname,
          record_no,
          event_type,
          previous_rating,
          rating_delta,
          new_rating
        )
        SELECT
          up.region,
          up.season,
          up.user_no,
          up.user_nickname,
          NULL,
          'season_reset',
          up.rating_before,
          CASE
            WHEN up.rating_before IS NOT NULL THEN up.rating_after - up.rating_before
            ELSE up.rating_after
          END,
          up.rating_after
        FROM updated_players up
      )
      SELECT COUNT(*)::int AS reset_count FROM updated_players
      ;`,
    values: [targetRegion, validatedFromSeason, validatedToSeason],
  });

  return {
    resetCount: Number(result.rows[0]?.reset_count || 0),
    toSeason: validatedToSeason,
  };
}

function verifyCronBearerToken(
  authorizationHeader,
  configuredSecret = process.env.CRON_SECRET,
) {
  if (typeof configuredSecret !== "string" || configuredSecret.trim() === "") {
    return false;
  }
  if (typeof authorizationHeader !== "string") {
    return false;
  }

  const match = authorizationHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return false;
  }

  const providedHash = crypto
    .createHash("sha256")
    .update(match[1], "utf8")
    .digest();
  const expectedHash = crypto
    .createHash("sha256")
    .update(configuredSecret.trim(), "utf8")
    .digest();

  return crypto.timingSafeEqual(providedHash, expectedHash);
}

function parseOptionalBoolean(value, fieldName, defaultValue) {
  if (isEmptyParam(value)) {
    return defaultValue;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  throw new ValidationError({
    message: `"${fieldName}" must be a boolean.`,
    action: `Provide true or false for "${fieldName}".`,
  });
}

async function runAutomatedMaintenance({
  region,
  season,
  anchors = [],
  autoClamp = false,
  applyDecay = true,
  now,
} = {}) {
  const explicitRegion = isEmptyParam(region) ? null : validateRegion(region);
  const explicitSeason = validateSeason(season);
  const resolvedAutoClamp = parseOptionalBoolean(
    autoClamp,
    "auto_clamp",
    false,
  );
  const resolvedApplyDecay = parseOptionalBoolean(
    applyDecay,
    "apply_decay",
    true,
  );

  if (anchors !== undefined && anchors !== null && !Array.isArray(anchors)) {
    throw new ValidationError({
      message: '"anchors" must be an array.',
      action: "Provide an array of player rating anchor objects.",
    });
  }

  if (Array.isArray(anchors)) {
    for (const a of anchors) {
      if (!a || typeof a !== "object" || Array.isArray(a)) {
        throw new ValidationError({
          message: "Each anchor entry must be an object.",
          action: "Provide valid anchor objects with user_no and rating.",
        });
      }
      if (!isEmptyParam(a.region)) {
        validateRegion(a.region);
      } else if (!explicitRegion) {
        throw new ValidationError({
          message:
            'Each anchor must specify "region" when top-level "region" is omitted.',
          action:
            'Include "region" on each anchor or specify top-level "region".',
        });
      }
    }
  }

  let targetRegions;
  if (explicitRegion) {
    targetRegions = [explicitRegion];
  } else {
    const regionsResult = await database.query({
      text: `
        SELECT DISTINCT UPPER(TRIM(region)) AS region
        FROM solare_players
        WHERE ($1::smallint IS NULL OR season = $1::smallint OR ($1::smallint = 9 AND season IS NULL))
        ORDER BY region ASC
        ;`,
      values: [explicitSeason],
    });
    targetRegions = regionsResult.rows
      .map((r) => r.region)
      .filter((r) => VALID_REGIONS.includes(r));
  }

  const regionResults = [];
  let totalDecayed = 0;
  let totalReconciled = 0;
  let totalInferred = 0;
  let totalProvenRanked = 0;
  let totalProvenPractice = 0;
  let totalDiscrepancies = 0;

  for (const reg of targetRegions) {
    let regSeason = explicitSeason;
    if (regSeason === null) {
      const seasonRes = await database.query({
        text: `
          SELECT COALESCE(MAX(season), 9)::int AS active_season
          FROM solare_players
          WHERE region = $1
          ;`,
        values: [reg],
      });
      regSeason = Number(seasonRes.rows[0]?.active_season || 9);
    }

    let decaySummary = { decayedCount: 0, players: [] };
    if (resolvedApplyDecay) {
      decaySummary = await applyInactivityDecay({
        region: reg,
        season: regSeason,
        now,
      });
    }

    const regionAnchors = Array.isArray(anchors)
      ? anchors.filter((a) =>
          !isEmptyParam(a.region)
            ? validateRegion(a.region) === reg
            : explicitRegion === reg,
        )
      : [];

    const reconcileSummary = await reconcileRegionRatings({
      region: reg,
      season: regSeason,
      anchors: regionAnchors,
      autoClamp: resolvedAutoClamp,
    });

    totalDecayed += decaySummary.decayedCount;
    totalReconciled += reconcileSummary.reconciledCount;
    totalInferred += reconcileSummary.inferredCount;
    totalProvenRanked += reconcileSummary.provenRanked;
    totalProvenPractice += reconcileSummary.provenPractice;
    totalDiscrepancies += reconcileSummary.discrepancies.length;

    regionResults.push({
      region: reg,
      season: regSeason,
      decayedCount: decaySummary.decayedCount,
      decayedPlayers: decaySummary.players,
      reconciledCount: reconcileSummary.reconciledCount,
      inferredCount: reconcileSummary.inferredCount,
      provenRanked: reconcileSummary.provenRanked,
      provenPractice: reconcileSummary.provenPractice,
      discrepancies: reconcileSummary.discrepancies,
    });
  }

  return {
    executed_at: new Date().toISOString(),
    regions_processed: regionResults.length,
    total_decayed: totalDecayed,
    total_reconciled: totalReconciled,
    total_inferred: totalInferred,
    total_proven_ranked: totalProvenRanked,
    total_proven_practice: totalProvenPractice,
    total_discrepancies: totalDiscrepancies,
    regions: regionResults,
  };
}

const solare = {
  VALID_REGIONS,
  SOLARE_STARTING_RATINGS,
  inferRegionFromCountry,
  inferRegionFromHeaders,
  getWinStreakBonus,
  getSeasonResetStartingRating,
  computeMatchModeProofs,
  proveRegionMatchModes,
  applyInactivityDecay,
  reconcileRegionRatings,
  runAutomatedMaintenance,
  verifyCronBearerToken,
  resetSeasonRatings,
  createOrResetSession,
  getOverlayData,
  getChatSummary,
  getPlayerSummary,
  getPlayerProfile,
  getRanking,
};

export default solare;
