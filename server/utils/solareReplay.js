import zlib from "node:zlib";

/**
 * Decoder for Arena of Solare replays (`.repz`, served by replay.pearlcdn.com).
 *
 * Layout (reverse engineered):
 * 1. Container: zip-like local headers WITHOUT a central directory. Each header is 38 bytes
 *    (standard 30 + 8 extra bytes) followed by the entry name and a zlib stream of `csize` bytes.
 *    One entry per player (`<entryId>.rep`), many `<id>_Monster.rep`, plus metadata entries
 *    (`StartInfo.rep`, `instanceInfo.rep`, `timeLineEvent.rep`, ...).
 * 2. Each inflated entry: 256-byte header (ASCII decimal decoded size, zero padded) + body.
 * 3. Body: ICE block cipher (8-byte blocks, ECB) keyed with the public BDO PAZ key, then
 *    Pearl Abyss' LZ compression (the same codec used by `.paz` archives).
 * 4. Decoded player entry ("PABR"): a per-player state timeline. Two tracks followed by
 *    numbered sections `[u8 id][u32 count][count fixed-size records]`; every record starts with
 *    a u64 time in ms. Section 9 is the equipment, section 12 the passive effects at t=0.
 */

const ICE_KEY = Buffer.from([0x51, 0xf3, 0x0f, 0x11, 0x04, 0x24, 0x6a, 0x00]);
const ENTRY_HEADER_SIZE = 256;
const LOCAL_HEADER_SIZE = 38;
const START_INFO_BLOCK_SIZE = 1136;

// ---------------------------------------------------------------------------
// ICE (8-byte key => 8 rounds)
// ---------------------------------------------------------------------------
const ICE_SMOD = [
  [333, 313, 505, 369],
  [379, 375, 319, 391],
  [361, 445, 451, 397],
  [397, 425, 395, 505],
];
const ICE_SXOR = [
  [0x83, 0x85, 0x9b, 0xcd],
  [0xcc, 0xa7, 0xad, 0x41],
  [0x4b, 0x2e, 0xd4, 0x33],
  [0xea, 0xcb, 0x2e, 0x04],
];
const ICE_PBOX = [
  0x00000001, 0x00000080, 0x00000400, 0x00002000, 0x00080000, 0x00200000,
  0x01000000, 0x40000000, 0x00000008, 0x00000020, 0x00000100, 0x00004000,
  0x00010000, 0x00800000, 0x04000000, 0x20000000, 0x00000004, 0x00000010,
  0x00000200, 0x00008000, 0x00020000, 0x00400000, 0x08000000, 0x10000000,
  0x00000002, 0x00000040, 0x00000800, 0x00001000, 0x00040000, 0x00100000,
  0x02000000, 0x80000000,
];
const ICE_KEYROT = [0, 1, 2, 3, 2, 1, 3, 0];

function gfMult(a, b, m) {
  let res = 0;
  while (b) {
    if (b & 1) res ^= a;
    a <<= 1;
    b >>= 1;
    if (a >= 256) a ^= m;
  }
  return res;
}

function gfExp7(b, m) {
  if (b === 0) return 0;
  let x = gfMult(b, b, m);
  x = gfMult(b, x, m);
  x = gfMult(x, x, m);
  return gfMult(b, x, m);
}

function icePerm32(x) {
  let res = 0;
  let i = 0;
  while (x) {
    if (x & 1) res |= ICE_PBOX[i];
    i++;
    x >>>= 1;
  }
  return res >>> 0;
}

let iceTables = null;

function getIceTables() {
  if (iceTables) return iceTables;

  const sbox = [0, 1, 2, 3].map(() => new Uint32Array(1024));
  for (let i = 0; i < 1024; i++) {
    const col = (i >> 1) & 0xff;
    const row = (i & 0x1) | ((i & 0x200) >> 8);
    sbox[0][i] = icePerm32(
      gfExp7(col ^ ICE_SXOR[0][row], ICE_SMOD[0][row]) << 24,
    );
    sbox[1][i] = icePerm32(
      gfExp7(col ^ ICE_SXOR[1][row], ICE_SMOD[1][row]) << 16,
    );
    sbox[2][i] = icePerm32(
      gfExp7(col ^ ICE_SXOR[2][row], ICE_SMOD[2][row]) << 8,
    );
    sbox[3][i] = icePerm32(gfExp7(col ^ ICE_SXOR[3][row], ICE_SMOD[3][row]));
  }

  const kb = new Uint16Array(4);
  for (let i = 0; i < 4; i++) {
    kb[3 - i] = (ICE_KEY[i * 2] << 8) | ICE_KEY[i * 2 + 1];
  }
  const keySchedule = [];
  for (let i = 0; i < 8; i++) {
    const kr = ICE_KEYROT[i];
    const sk = [0, 0, 0];
    for (let j = 0; j < 15; j++) {
      for (let k = 0; k < 4; k++) {
        const idx = (kr + k) & 3;
        const bit = kb[idx] & 1;
        sk[j % 3] = ((sk[j % 3] << 1) | bit) >>> 0;
        kb[idx] = (kb[idx] >>> 1) | ((bit ^ 1) << 15);
      }
    }
    keySchedule.push(sk);
  }

  iceTables = { sbox, keySchedule };
  return iceTables;
}

function iceF(p, sk, sbox) {
  const tl = ((p >>> 16) & 0x3ff) | (((p >>> 14) | (p << 18)) & 0xffc00);
  const tr = (p & 0x3ff) | ((p << 2) & 0xffc00);
  let al = sk[2] & (tl ^ tr);
  let ar = al ^ tr;
  al ^= tl;
  al ^= sk[0];
  ar ^= sk[1];
  return (
    (sbox[0][al >>> 10] |
      sbox[1][al & 0x3ff] |
      sbox[2][ar >>> 10] |
      sbox[3][ar & 0x3ff]) >>>
    0
  );
}

/** ICE-decrypts `data` (length truncated to a multiple of 8). Repeated blocks are memoized. */
export function iceDecrypt(data) {
  const { sbox, keySchedule } = getIceTables();
  const length = data.length - (data.length % 8);
  const out = Buffer.allocUnsafe(length);
  const cache = new Map();

  for (let offset = 0; offset < length; offset += 8) {
    const hi = data.readUInt32BE(offset);
    const lo = data.readUInt32BE(offset + 4);
    const cacheKey = hi * 4294967296 + lo;
    let plain = cache.get(cacheKey);
    if (!plain) {
      let l = hi;
      let r = lo;
      for (let i = 7; i > 0; i -= 2) {
        l = (l ^ iceF(r, keySchedule[i], sbox)) >>> 0;
        r = (r ^ iceF(l, keySchedule[i - 1], sbox)) >>> 0;
      }
      plain = [r, l];
      cache.set(cacheKey, plain);
    }
    out.writeUInt32BE(plain[0], offset);
    out.writeUInt32BE(plain[1], offset + 4);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Pearl Abyss LZ decompression (port of quickbms `blackdesert_unpack_core`)
// ---------------------------------------------------------------------------
const PA_LITERAL_TABLE = [4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0];

function readU32LE(buf, offset) {
  if (offset + 4 <= buf.length) return buf.readUInt32LE(offset);
  let value = 0;
  for (let i = 3; i >= 0; i--) {
    value = value * 256 + (offset + i < buf.length ? buf[offset + i] : 0);
  }
  return value >>> 0;
}

export function paDecompress(input) {
  const flags = input[0];
  let compressedLength;
  let decompressedLength;
  let ip;

  if (flags & 0x02) {
    compressedLength = readU32LE(input, 1);
    decompressedLength = readU32LE(input, 5);
    ip = 9;
  } else {
    compressedLength = input[1];
    decompressedLength = input[2];
    ip = 3;
  }

  if (!(flags & 0x01)) {
    return Buffer.from(input.subarray(ip, ip + decompressedLength));
  }

  const out = Buffer.alloc(decompressedLength + 16);
  const lastOut = decompressedLength - 1;
  const lastIn = compressedLength - 1;
  let op = 0;
  let group = 1;
  let header;

  for (;;) {
    for (;;) {
      if (group === 1) {
        if (ip + 3 > lastIn) throw new Error("PA decompress: truncated group");
        group = readU32LE(input, ip);
        ip += 4;
      }
      if (ip + 3 > lastIn) throw new Error("PA decompress: truncated block");
      header = readU32LE(input, ip);
      if (!(group & 1)) break;

      let distance;
      let length;
      const type = header & 0x03;
      if (type === 3) {
        if ((header & 0x7f) === 3) {
          distance = header >>> 15;
          length = ((header >>> 7) & 0xff) + 3;
          ip += 4;
        } else {
          distance = (header >>> 7) & 0x1ffff;
          length = ((header >>> 2) & 0x1f) + 2;
          ip += 3;
        }
      } else if (type === 2) {
        distance = (header & 0xffff) >>> 6;
        length = ((header >>> 2) & 0xf) + 3;
        ip += 2;
      } else if (type === 1) {
        distance = (header & 0xffff) >>> 2;
        length = 3;
        ip += 2;
      } else {
        distance = (header & 0xff) >>> 2;
        length = 3;
        ip += 1;
      }

      if (op - distance < 0 || distance < 3 || length > lastOut - op - 3) {
        throw new Error("PA decompress: invalid back-reference");
      }
      // Overlapping 4-byte copies in steps of 3, exactly like the original codec.
      for (let p = op, i = 0; i < length; i += 3, p += 3) {
        const s = p - distance;
        const b0 = out[s];
        const b1 = out[s + 1];
        const b2 = out[s + 2];
        const b3 = out[s + 3];
        out[p] = b0;
        out[p + 1] = b1;
        out[p + 2] = b2;
        out[p + 3] = b3;
      }
      group >>>= 1;
      op += length;
    }

    if (op >= lastOut - 10) break;

    const literalCount = PA_LITERAL_TABLE[group & 0xf];
    out.writeUInt32LE(header >>> 0, op);
    group >>>= literalCount;
    op += literalCount;
    ip += literalCount;
  }

  if (op <= lastOut) {
    const endOfInput = lastIn + 1;
    for (;;) {
      if (group === 1) {
        ip += 4;
        group = 0x80000000;
      }
      if (ip >= endOfInput) break;
      out[op++] = input[ip++];
      group >>>= 1;
      if (op > lastOut) return out.subarray(0, op);
    }
    throw new Error("PA decompress: input exhausted");
  }

  return out.subarray(0, op);
}

// ---------------------------------------------------------------------------
// Container + entries
// ---------------------------------------------------------------------------

/** Lists entries of a `.repz` container: [{ name, compressed }] (compressed = zlib stream). */
export function listReplayEntries(buffer) {
  const entries = [];
  let p = 0;
  while (p + LOCAL_HEADER_SIZE <= buffer.length) {
    if (buffer.readUInt32LE(p) !== 0x04034b50) break;
    const compressedSize = buffer.readUInt32LE(p + 18);
    const nameLength = buffer.readUInt16LE(p + 26);
    const name = buffer
      .subarray(p + LOCAL_HEADER_SIZE, p + LOCAL_HEADER_SIZE + nameLength)
      .toString("latin1");
    const dataStart = p + LOCAL_HEADER_SIZE + nameLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error("Replay container truncated");
    entries.push({ name, compressed: buffer.subarray(dataStart, dataEnd) });
    p = dataEnd;
  }
  if (entries.length === 0) throw new Error("Not a Solare replay container");
  return entries;
}

/** Inflates, decrypts and decompresses one container entry. */
export function decodeReplayEntry(compressed) {
  const inflated = zlib.inflateSync(compressed);
  const headerText = inflated
    .subarray(0, ENTRY_HEADER_SIZE)
    .toString("latin1")
    .split("\0")[0];
  const expectedSize = Number.parseInt(headerText, 10);
  const decoded = paDecompress(
    iceDecrypt(inflated.subarray(ENTRY_HEADER_SIZE)),
  );
  if (Number.isFinite(expectedSize) && decoded.length !== expectedSize) {
    throw new Error(
      `Replay entry size mismatch (expected ${expectedSize}, got ${decoded.length})`,
    );
  }
  return decoded;
}

// ---------------------------------------------------------------------------
// PABR player timeline
// ---------------------------------------------------------------------------

// Record size per section id (observed across SA/NA replays).
const SECTION_RECORD_SIZES = {
  3: 48,
  4: 16,
  5: 16,
  6: 32,
  7: 16,
  8: 40,
  9: 48,
  10: 24,
  11: 16,
  12: 16,
  20: 32,
  25: 40,
  31: 24,
};
const PABR_FOOTER_SIZE = 12;

/** Returns { [sectionId]: { count, size, offset } } for a decoded player entry. */
export function parsePabrSections(raw) {
  if (raw.toString("latin1", 0, 4) !== "PABR") {
    throw new Error("Not a PABR player timeline");
  }
  let p = 4;
  const trackACount = raw.readUInt32LE(p + 1);
  p += 5 + trackACount * 24;
  const trackBCount = raw.readUInt32LE(p + 1);
  p += 5 + trackBCount * 40;

  const end = raw.length - PABR_FOOTER_SIZE;

  function walk(position, id) {
    if (position >= end) return {};
    if (raw[position] !== id) return null;
    const count = raw.readUInt32LE(position + 1);
    const body = position + 5;
    const sizes =
      count === 0
        ? [0]
        : SECTION_RECORD_SIZES[id]
          ? [SECTION_RECORD_SIZES[id]]
          : Array.from({ length: 256 }, (_, i) => i + 1);
    for (const size of sizes) {
      const next = body + count * size;
      if (next > end && next !== end) continue;
      const rest = walk(next, id + 1);
      if (rest) {
        rest[id] = { count, size, offset: body };
        return rest;
      }
    }
    return null;
  }

  const sections = walk(p, 1);
  if (!sections) throw new Error("Could not parse PABR sections");
  return sections;
}

// Equipment slot index (section 9) -> position in the 14-entry gear array used by the UI.
const GEAR_SLOT_ORDER = [0, 1, 29, 6, 3, 4, 5, 7, 10, 11, 8, 9, 12, 27];

// Passive effects (section 12, level = set tier) produced by combined crystals.
const CRYSTAL_SET_EFFECTS = {
  56052: 15252, // Ultimate Combined Magic Crystal - Macalod
  56054: 15253,
  15313: 15819,
};

export function extractPlayerLoadout(raw) {
  const sections = parsePabrSections(raw);

  const equipped = new Map();
  const gearSection = sections[9];
  if (gearSection) {
    for (let i = 0; i < gearSection.count; i++) {
      const record = gearSection.offset + i * gearSection.size;
      equipped.set(raw[record + 8], raw.readUInt32LE(record + 12));
    }
  }
  const gear = GEAR_SLOT_ORDER.map((slot) =>
    equipped.has(slot) ? [equipped.get(slot)] : [],
  );

  const crystalSets = [];
  const passiveSection = sections[12];
  if (passiveSection) {
    for (let i = 0; i < passiveSection.count; i++) {
      const record = passiveSection.offset + i * passiveSection.size;
      const level = raw.readUInt16LE(record + 12);
      const effectId = raw.readUInt16LE(record + 14);
      const crystalId = CRYSTAL_SET_EFFECTS[effectId];
      if (crystalId) crystalSets.push({ crystal_id: crystalId, tier: level });
    }
  }

  return { gear, crystal_sets: crystalSets };
}

function readUtf16Name(buf, offset, byteLength) {
  return buf
    .subarray(offset, offset + byteLength)
    .toString("utf16le")
    .split("\0")[0];
}

/** StartInfo.rep: [PABR][u32 count] + count * 1136-byte player blocks. */
export function parseStartInfo(raw) {
  if (raw.toString("latin1", 0, 4) !== "PABR") {
    throw new Error("Invalid StartInfo entry");
  }
  const count = raw.readUInt32LE(4);
  const players = [];
  for (let i = 0; i < count; i++) {
    const block = 8 + i * START_INFO_BLOCK_SIZE;
    if (block + START_INFO_BLOCK_SIZE > raw.length) break;
    players.push({
      entry_id: raw.readUInt32LE(block),
      character_name: readUtf16Name(raw, block + 4, 62),
      family_name: readUtf16Name(raw, block + 66, 62),
    });
  }
  return players;
}

/** Full decode: one loadout per player of the match. */
export function decodeReplayLoadouts(buffer) {
  const entries = listReplayEntries(buffer);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const startInfoEntry = byName.get("StartInfo.rep");
  if (!startInfoEntry) throw new Error("Replay has no StartInfo entry");

  const players = parseStartInfo(decodeReplayEntry(startInfoEntry.compressed));
  return players.map((player) => {
    const entry = byName.get(`${player.entry_id}.rep`);
    if (!entry) return { ...player, gear: [], crystal_sets: [] };
    return {
      ...player,
      ...extractPlayerLoadout(decodeReplayEntry(entry.compressed)),
    };
  });
}
