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
import { scoreMatchPlayers } from "~~/app/utils/solareMatchScore.js";

const VALID_REGIONS = ["SA", "NA", "EU", "KR", "JP", "RU", "TR", "TW"];

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

// Scores the whole lobby of one match and returns the entry of `nickname`
// ({ score, award } — both null when the lobby is incomplete).
async function getMatchPlayerScore(region, recordNo, nickname) {
  const lobbyResult = await database.query({
    text: `
      SELECT
        user_nickname,
        is_winner,
        kill_count,
        death_count,
        cc_applied_count,
        damage_done,
        damage_taken,
        recovery
      FROM
        solare_match_players
      WHERE
        region = $1
        AND record_no = $2
      ;`,
    values: [region, recordNo],
  });

  const scored = scoreMatchPlayers(lobbyResult.rows);
  return scored.find((p) => p.user_nickname === nickname) || null;
}

function validateRegion(region) {
  if (region === undefined || region === null) {
    return "SA";
  }

  if (typeof region !== "string" || region.trim().length === 0) {
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

  const latestMatchScore = hasMatches
    ? await getMatchPlayerScore(
        targetRegion,
        latestRecordNo,
        latestMatchRow.user_nickname,
      )
    : null;

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
        performance_score: latestMatchScore?.score ?? null,
        award: latestMatchScore?.award ?? null,
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

const solare = {
  VALID_REGIONS,
  getWinStreakBonus,
  createOrResetSession,
  getOverlayData,
  getChatSummary,
};

export default solare;
