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

const VALID_REGIONS = ["SA", "NA", "EU", "KR", "JP", "RU", "TR", "TW"];

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
        record_no,
        is_winner,
        vary_rank_rating
      FROM
        solare_match_players
      WHERE
        region = $1
        AND (
          ($3::bigint IS NOT NULL AND user_no = $3::bigint)
          OR LOWER(user_nickname) = LOWER($2)
        )
      ORDER BY
        record_no ASC
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

async function findPlayerIdentityAndWatermark(
  region,
  nick,
  knownUserNo = null,
) {
  const playerResult = await database.query({
    text: `
      SELECT
        user_nickname,
        user_no
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
        MAX(record_no) AS latest_record_no,
        (ARRAY_AGG(user_nickname ORDER BY record_no DESC))[1] AS latest_nickname,
        (ARRAY_AGG(user_no ORDER BY record_no DESC) FILTER (WHERE user_no IS NOT NULL))[1] AS latest_user_no,
        COUNT(*)::int AS match_count
      FROM
        solare_match_players
      WHERE
        region = $1
        AND (
          ($3::bigint IS NOT NULL AND user_no = $3::bigint)
          OR LOWER(user_nickname) = LOWER($2)
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
  const rating = validateRating(sessionInput.rating, !token);

  const playerIdentity = await findPlayerIdentityAndWatermark(region, nick);

  if (token) {
    return await resetExistingSession({
      token,
      region,
      playerIdentity,
      explicitRating: rating,
    });
  }

  return await runInsertSessionQuery({
    region,
    playerIdentity,
    anchorRating: rating,
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

async function getOverlayData({ nick, region, token } = {}) {
  const validatedToken = validateToken(token);

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
        *
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
    values: [targetRegion, targetNick, targetUserNo],
  });

  const playerRow = playerResult.rows[0] || null;
  const resolvedUserNo = playerRow?.user_no || targetUserNo || null;

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

  let rating = null;
  let sessionStats = null;

  if (sessionRow) {
    const enrichedMatches = enrichMatchRows(matchRows);

    const anchorRecordNo = Number(sessionRow.anchor_record_no);
    const sessionStartRecordNo = Number(sessionRow.session_start_record_no);

    const anchorDeltaSum = enrichedMatches
      .filter((m) => m.record_no > anchorRecordNo && m.effective_delta !== null)
      .reduce((sum, m) => sum + m.effective_delta, 0);

    rating = Math.max(0, Number(sessionRow.anchor_rating) + anchorDeltaSum);

    const sessionRowsDesc = enrichedMatches
      .filter((m) => m.record_no > sessionStartRecordNo)
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

  return {
    region: targetRegion,
    user_nickname: canonicalNick,
    user_no: canonicalUserNo ? String(canonicalUserNo) : null,
    current_ranking: playerRow ? Number(playerRow.current_ranking) : null,
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
          ;`,
        values: [targetRegion, targetNick, resolvedUserNo],
      });

      targetSeason = seasonResult.rows[0]?.latest_season
        ? Number(seasonResult.rows[0].latest_season)
        : 9;
    }
  }

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
        a.class_type - b.class_type,
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
    playerRow?.user_nickname || latestMatchRow?.user_nickname || targetNick;
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

  let activeCurrentRanking = null;
  let activeClassRanking = null;

  if (isPlayerRowForTargetSeason && playerRow.current_ranking !== null) {
    const rankingPositionResult = await database.query({
      text: `
        WITH deduplicated_ranking AS (
          SELECT DISTINCT ON (current_ranking)
            user_no,
            user_nickname,
            current_ranking,
            class_type
          FROM
            solare_players
          WHERE
            region = $1
            AND current_ranking IS NOT NULL
            AND current_ranking >= 1
            AND (
              season = $2
              OR ($2 = 9 AND season IS NULL)
            )
          ORDER BY
            current_ranking ASC,
            updated_at DESC,
            last_seen_at DESC,
            win_count DESC
        ),
        ranking_with_most_played_class AS (
          SELECT
            dr.user_no,
            dr.user_nickname,
            dr.current_ranking,
            COALESCE(mp_top.class_type, dr.class_type)::smallint AS class_type
          FROM
            deduplicated_ranking dr
          LEFT JOIN LATERAL (
            SELECT
              mp.class_type
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
                (dr.user_no IS NOT NULL AND mp.user_no = dr.user_no)
                OR ((dr.user_no IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER(dr.user_nickname))
              )
            GROUP BY
              mp.class_type,
              mp.skill_branch_type
            ORDER BY
              COUNT(*) DESC,
              SUM(CASE WHEN mp.is_winner THEN 1 ELSE 0 END) DESC,
               mp.class_type ASC
            LIMIT 1
          ) mp_top ON true
        ),
        ranked_with_class AS (
          SELECT
            user_no,
            user_nickname,
            current_ranking,
            class_type,
            ROW_NUMBER() OVER (
              PARTITION BY class_type
              ORDER BY current_ranking ASC
            )::int AS class_ranking
          FROM
            ranking_with_most_played_class
        )
        SELECT
          current_ranking,
          class_ranking
        FROM
          ranked_with_class
        WHERE
          ($3::bigint IS NOT NULL AND user_no = $3::bigint)
          OR LOWER(user_nickname) = LOWER($4)
        LIMIT 1
        ;`,
      values: [targetRegion, targetSeason, canonicalUserNo, canonicalNick],
    });

    if (rankingPositionResult.rowCount > 0) {
      activeCurrentRanking = Number(
        rankingPositionResult.rows[0].current_ranking,
      );
      activeClassRanking = Number(rankingPositionResult.rows[0].class_ranking);
    }
  }

  return {
    region: targetRegion,
    season: targetSeason,
    user_nickname: canonicalNick,
    user_no: canonicalUserNo ? String(canonicalUserNo) : null,
    current_ranking: activeCurrentRanking,
    class_ranking: activeClassRanking,
    class_type: primaryClassType !== null ? Number(primaryClassType) : null,
    skill_branch_type:
      primarySkillBranchType !== null ? Number(primarySkillBranchType) : null,
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

  const playersResult = await database.query({
    text: `
      WITH deduplicated_ranking AS (
        SELECT DISTINCT ON (current_ranking)
          user_no,
          user_nickname,
          current_ranking,
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
          AND current_ranking IS NOT NULL
          AND current_ranking >= 1
          AND (
            season = $2
            OR ($2 = 9 AND season IS NULL)
          )
        ORDER BY
          current_ranking ASC,
          updated_at DESC,
          last_seen_at DESC,
          win_count DESC
      ),
      ranking_with_most_played_class AS (
        SELECT
          dr.user_no,
          dr.user_nickname,
          dr.current_ranking,
          COALESCE(mp_top.class_type, dr.class_type)::smallint AS class_type,
          COALESCE(mp_top.skill_branch_type, dr.skill_branch_type)::smallint AS skill_branch_type,
          dr.win_count,
          dr.lose_count,
          dr.draw_count,
          dr.updated_at
        FROM
          deduplicated_ranking dr
        LEFT JOIN LATERAL (
          SELECT
            mp.class_type,
            mp.skill_branch_type
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
              (dr.user_no IS NOT NULL AND mp.user_no = dr.user_no)
              OR ((dr.user_no IS NULL OR mp.user_no IS NULL) AND LOWER(mp.user_nickname) = LOWER(dr.user_nickname))
            )
          GROUP BY
            mp.class_type,
            mp.skill_branch_type
          ORDER BY
            COUNT(*) DESC,
            SUM(CASE WHEN mp.is_winner THEN 1 ELSE 0 END) DESC,
            mp.class_type ASC
          LIMIT 1
        ) mp_top ON true
      ),
      ranked_with_class AS (
        SELECT
          user_no,
          user_nickname,
          current_ranking,
          ROW_NUMBER() OVER (
            PARTITION BY class_type
            ORDER BY current_ranking ASC
          )::int AS class_ranking,
          class_type,
          skill_branch_type,
          win_count,
          lose_count,
          draw_count,
          updated_at
        FROM
          ranking_with_most_played_class
      )
      SELECT
        user_no,
        user_nickname,
        current_ranking,
        class_ranking,
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
        AND ($3::smallint IS NOT NULL OR current_ranking <= 100)
      ORDER BY
        current_ranking ASC
      LIMIT 100
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
        p.current_ranking !== null && p.current_ranking !== undefined
          ? Number(p.current_ranking)
          : index + 1,
      class_ranking:
        p.class_ranking !== null && p.class_ranking !== undefined
          ? Number(p.class_ranking)
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
      updated_at: p.updated_at ? new Date(p.updated_at).toISOString() : null,
    };
  });

  return {
    region: targetRegion,
    season: targetSeason,
    players,
  };
}

const solare = {
  VALID_REGIONS,
  inferRegionFromCountry,
  inferRegionFromHeaders,
  getWinStreakBonus,
  createOrResetSession,
  getOverlayData,
  getChatSummary,
  getPlayerProfile,
  getRanking,
};

export default solare;
