import database from "~~/infra/database.js";
import { NotFoundError, ValidationError } from "~~/infra/errors.js";
import { decodeReplayLoadouts } from "~~/server/utils/solareReplay.js";

const VALID_REGIONS = ["SA", "NA", "EU", "KR", "JP", "RU", "TR", "TW"];
const REPLAY_HOST = "replay.pearlcdn.com";
const MAX_REPLAY_BYTES = 40 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20000;
const RETRY_FAILED_AFTER_MS = 60 * 60 * 1000;

const inFlight = new Map();

function validateRegion(region) {
  const value = typeof region === "string" ? region.trim().toUpperCase() : "";
  if (!VALID_REGIONS.includes(value)) {
    throw new ValidationError({
      message: `Invalid region '${region}'.`,
      action: `Use one of: ${VALID_REGIONS.join(", ")}.`,
    });
  }
  return value;
}

function validateRecordNo(recordNo) {
  const value = Number(recordNo);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError({
      message: "Invalid 'record_no'.",
      action: "Send the numeric record number of the match.",
    });
  }
  return value;
}

function isAllowedReplayUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === REPLAY_HOST;
  } catch {
    return false;
  }
}

async function downloadReplay(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Replay download failed with HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_REPLAY_BYTES) {
    throw new Error("Replay file is too large");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_REPLAY_BYTES) {
    throw new Error("Replay file is too large");
  }
  return buffer;
}

async function readStoredLoadouts(region, recordNo) {
  const result = await database.query({
    text: `
      SELECT user_nickname, character_name, gear, crystal_sets
      FROM solare_replay_loadouts
      WHERE region = $1 AND record_no = $2
      ORDER BY user_nickname
      ;`,
    values: [region, recordNo],
  });
  return result.rows.map((row) => ({
    user_nickname: row.user_nickname,
    character_name: row.character_name,
    gear: row.gear,
    crystal_sets: row.crystal_sets,
  }));
}

async function saveParseResult(
  region,
  recordNo,
  { status, error = null, players = [] },
) {
  const client = await database.getNewClient();
  try {
    await client.query("BEGIN;");
    for (const player of players) {
      await client.query({
        text: `
          INSERT INTO solare_replay_loadouts
            (region, record_no, user_nickname, character_name, gear, crystal_sets)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
          ON CONFLICT (region, record_no, user_nickname) DO UPDATE SET
            character_name = EXCLUDED.character_name,
            gear = EXCLUDED.gear,
            crystal_sets = EXCLUDED.crystal_sets
          ;`,
        values: [
          region,
          recordNo,
          player.user_nickname,
          player.character_name || null,
          JSON.stringify(player.gear),
          JSON.stringify(player.crystal_sets || []),
        ],
      });
    }
    await client.query({
      text: `
        INSERT INTO solare_replay_parses (region, record_no, status, error, parsed_at)
        VALUES ($1, $2, $3, $4, timezone('utc', now()))
        ON CONFLICT (region, record_no) DO UPDATE SET
          status = EXCLUDED.status,
          error = EXCLUDED.error,
          parsed_at = EXCLUDED.parsed_at
        ;`,
      values: [region, recordNo, status, error],
    });
    await client.query("COMMIT;");
  } catch (err) {
    await client.query("ROLLBACK;").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

async function parseAndStore(region, recordNo, replayUrl) {
  try {
    const buffer = await downloadReplay(replayUrl);
    const decoded = decodeReplayLoadouts(buffer);
    const players = decoded
      .filter((p) => p.family_name && p.gear.some((slot) => slot.length > 0))
      .map((p) => ({
        user_nickname: p.family_name,
        character_name: p.character_name,
        gear: p.gear,
        crystal_sets: p.crystal_sets,
      }));
    await saveParseResult(region, recordNo, { status: "ok", players });
    return { status: "ok", players };
  } catch (err) {
    const message = String(err?.message || err).slice(0, 500);
    await saveParseResult(region, recordNo, {
      status: "error",
      error: message,
    });
    return { status: "error", players: [] };
  }
}

/**
 * Equipment of every player in a match, decoded from the match replay on first request and
 * cached in the database afterwards.
 */
async function getMatchLoadouts({ region, record_no: recordNoInput } = {}) {
  const targetRegion = validateRegion(region);
  const recordNo = validateRecordNo(recordNoInput);

  const parseResult = await database.query({
    text: `
      SELECT status, parsed_at
      FROM solare_replay_parses
      WHERE region = $1 AND record_no = $2
      ;`,
    values: [targetRegion, recordNo],
  });
  const parse = parseResult.rows[0];

  if (parse?.status === "ok") {
    return {
      region: targetRegion,
      record_no: recordNo,
      status: "ok",
      players: await readStoredLoadouts(targetRegion, recordNo),
    };
  }

  const failedRecently =
    parse?.status === "error" &&
    Date.now() - new Date(parse.parsed_at).getTime() < RETRY_FAILED_AFTER_MS;
  if (failedRecently) {
    return {
      region: targetRegion,
      record_no: recordNo,
      status: "error",
      players: [],
    };
  }

  const matchResult = await database.query({
    text: `
      SELECT repz_download_url
      FROM solare_matches
      WHERE region = $1 AND record_no = $2
      ;`,
    values: [targetRegion, recordNo],
  });
  if (matchResult.rowCount === 0) {
    throw new NotFoundError({
      message: `Match '${recordNo}' was not found in region '${targetRegion}'.`,
      action: "Check the region and record number of the match.",
    });
  }

  const replayUrl = matchResult.rows[0].repz_download_url;
  if (!replayUrl || !isAllowedReplayUrl(replayUrl)) {
    return {
      region: targetRegion,
      record_no: recordNo,
      status: "no_replay",
      players: [],
    };
  }

  const key = `${targetRegion}:${recordNo}`;
  if (!inFlight.has(key)) {
    inFlight.set(
      key,
      parseAndStore(targetRegion, recordNo, replayUrl).finally(() =>
        inFlight.delete(key),
      ),
    );
  }
  const result = await inFlight.get(key);

  return {
    region: targetRegion,
    record_no: recordNo,
    status: result.status,
    players: result.players,
  };
}

const solareLoadout = {
  getMatchLoadouts,
};

export default solareLoadout;
