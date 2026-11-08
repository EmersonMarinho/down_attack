import fs from "node:fs";
import path from "node:path";
import {
  decodeReplayEntry,
  extractPlayerLoadout,
  listReplayEntries,
  paDecompress,
  parseStartInfo,
} from "~~/server/utils/solareReplay.js";

// Real `StartInfo.rep` entry extracted from replay solare_8_955376 (SA): exercises the real
// container header, zlib, ICE decryption and Pearl Abyss LZ decompression end to end.
const START_INFO_FIXTURE = path.resolve(
  "tests/fixtures/solare/start-info-955376.repz",
);

function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value);
  return b;
}

function section(id, records) {
  return Buffer.concat([Buffer.from([id]), u32(records.length), ...records]);
}

function gearRecord(slot, itemId) {
  const r = Buffer.alloc(48, 0xff);
  r.fill(0, 0, 8);
  r[8] = slot;
  r[9] = 0x9d;
  r[10] = 0x07;
  r[11] = 0x41;
  r.writeUInt32LE(itemId, 12);
  r.fill(0, 40);
  return r;
}

function passiveRecord(level, effectId) {
  const r = Buffer.alloc(16);
  r.writeUInt32LE(0xffffffff, 8);
  r.writeUInt16LE(level, 12);
  r.writeUInt16LE(effectId, 14);
  return r;
}

function buildPabr({ gear = [], passives = [] }) {
  const parts = [Buffer.from("PABR")];
  parts.push(Buffer.from([0]), u32(1), Buffer.alloc(24)); // track A
  parts.push(Buffer.from([0x21]), u32(1), Buffer.alloc(40)); // track B
  for (let id = 1; id <= 12; id++) {
    if (id === 9)
      parts.push(
        section(
          9,
          gear.map(([s, i]) => gearRecord(s, i)),
        ),
      );
    else if (id === 12)
      parts.push(
        section(
          12,
          passives.map(([l, e]) => passiveRecord(l, e)),
        ),
      );
    else parts.push(section(id, []));
  }
  parts.push(Buffer.alloc(12)); // footer
  return Buffer.concat(parts);
}

describe("solareReplay", () => {
  test("decodes the real StartInfo entry and maps entries to players", () => {
    const entries = listReplayEntries(fs.readFileSync(START_INFO_FIXTURE));
    expect(entries.map((e) => e.name)).toEqual(["StartInfo.rep"]);

    const players = parseStartInfo(decodeReplayEntry(entries[0].compressed));
    expect(players).toHaveLength(6);
    expect(players.map((p) => p.family_name).sort()).toEqual([
      "ElzDex",
      "Fluctuating",
      "Khaellan",
      "Neri",
      "Okazaki",
      "Quellox",
    ]);
    expect(players.find((p) => p.family_name === "Neri")).toMatchObject({
      character_name: "DkJyusan",
      entry_id: 11764739,
    });
  });

  test("extracts equipment in UI slot order and combined crystal sets", () => {
    const raw = buildPabr({
      gear: [
        [0, 741313],
        [1, 741504],
        [3, 740603],
        [4, 741604],
        [5, 741606],
        [6, 741601],
        [7, 741608],
        [8, 741617],
        [9, 741617],
        [10, 931609],
        [11, 931610],
        [12, 741623],
        [14, 17385613], // costume: ignored by the AoS layout
        [27, 741627],
        [29, 741413],
      ],
      passives: [
        [1, 4816],
        [2, 56052],
        [1, 56054],
      ],
    });

    const { gear, crystal_sets: sets } = extractPlayerLoadout(raw);
    expect(gear.map((slot) => slot[0])).toEqual([
      741313, 741504, 741413, 741601, 740603, 741604, 741606, 741608, 931609,
      931610, 741617, 741617, 741623, 741627,
    ]);
    expect(sets).toEqual([
      { crystal_id: 15252, tier: 2 },
      { crystal_id: 15253, tier: 1 },
    ]);
  });

  test("leaves missing slots empty", () => {
    const { gear } = extractPlayerLoadout(buildPabr({ gear: [[0, 741301]] }));
    expect(gear[0]).toEqual([741301]);
    expect(gear.slice(1).every((slot) => slot.length === 0)).toBe(true);
  });

  test("paDecompress copies stored (uncompressed) blocks", () => {
    const payload = Buffer.from("hello solare");
    const input = Buffer.concat([
      Buffer.from([0x02]),
      u32(9 + payload.length),
      u32(payload.length),
      payload,
    ]);
    expect(paDecompress(input).toString()).toBe("hello solare");
  });

  test("rejects files that are not Solare replays", () => {
    expect(() => listReplayEntries(Buffer.from("not a replay"))).toThrow();
  });
});
