import orchestrator from "tests/orchestrator.js";
import database from "~~/infra/database.js";
import webserver from "~~/infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

const NERI_GEAR = [
  [741313],
  [741504],
  [741413],
  [741601],
  [740603],
  [741604],
  [741606],
  [741608],
  [931610],
  [931610],
  [741617],
  [741617],
  [741623],
  [741627],
];

function gearUrl(params) {
  return `${webserver.origin}/api/v1/solare/match/gear?${new URLSearchParams(params)}`;
}

describe("GET /api/v1/solare/match/gear", () => {
  describe("Anonymous user", () => {
    test("With invalid region or record_no", async () => {
      const invalidRegion = await fetch(
        gearUrl({ region: "XX", record_no: "1" }),
      );
      expect(invalidRegion.status).toBe(400);
      expect((await invalidRegion.json()).name).toBe("ValidationError");

      const invalidRecord = await fetch(
        gearUrl({ region: "SA", record_no: "abc" }),
      );
      expect(invalidRecord.status).toBe(400);
    });

    test("With a match that does not exist", async () => {
      const response = await fetch(
        gearUrl({ region: "SA", record_no: "123456789" }),
      );
      expect(response.status).toBe(404);
      expect((await response.json()).name).toBe("NotFoundError");
    });

    test("With a match without replay", async () => {
      await orchestrator.createSolareMatch({
        record_no: 900001,
        repz_download_url: null,
      });

      const response = await fetch(
        gearUrl({ region: "SA", record_no: "900001" }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        region: "SA",
        record_no: 900001,
        status: "no_replay",
        players: [],
      });
    });

    test("Never downloads replays from hosts other than replay.pearlcdn.com", async () => {
      await orchestrator.createSolareMatch({
        record_no: 900002,
        repz_download_url: "https://example.com/solare_8_900002_abcd.repz",
      });

      const response = await fetch(
        gearUrl({ region: "sa", record_no: "900002" }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe("no_replay");
      expect(body.players).toEqual([]);
    });

    test("With a replay already decoded (served from the database)", async () => {
      await orchestrator.createSolareMatch({ record_no: 955376 });
      await database.query({
        text: `
          INSERT INTO solare_replay_loadouts
            (region, record_no, user_nickname, character_name, gear, crystal_sets)
          VALUES ('SA', 955376, 'Neri', 'DkJyusan', $1::jsonb, $2::jsonb);`,
        values: [
          JSON.stringify(NERI_GEAR),
          JSON.stringify([{ crystal_id: 15252, tier: 2 }]),
        ],
      });
      await database.query(`
        INSERT INTO solare_replay_parses (region, record_no, status)
        VALUES ('SA', 955376, 'ok');`);

      const response = await fetch(
        gearUrl({ region: "SA", record_no: "955376" }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
      expect(await response.json()).toEqual({
        region: "SA",
        record_no: 955376,
        status: "ok",
        players: [
          {
            user_nickname: "Neri",
            character_name: "DkJyusan",
            gear: NERI_GEAR,
            crystal_sets: [{ crystal_id: 15252, tier: 2 }],
          },
        ],
      });
    });
  });
});
