import {
  scoreMatchPlayers,
  SCORE_WEIGHTS,
} from "~/app/utils/solareMatchScore.js";

function player(user_nickname, is_winner, k, d, cc, dmg, taken, rec) {
  return {
    user_nickname,
    is_winner,
    kill_count: k,
    death_count: d,
    cc_applied_count: cc,
    damage_done: dmg,
    damage_taken: taken,
    recovery: rec,
  };
}

// Real match SA #938114 (official GetRecordDetail numbers).
const MATCH_938114 = [
  player("Skito", true, 5, 1, 11, 230070, 163931, 142774),
  player("BeyondTheGraves", true, 2, 1, 8, 122457, 136922, 119019),
  player("Shiuu", true, 1, 2, 16, 153550, 131625, 100371),
  player("MkT", false, 2, 3, 7, 177269, 173168, 126608),
  player("BahiaSSA", false, 2, 2, 10, 121124, 185815, 151707),
  player("Chuvinha", false, 0, 3, 8, 134085, 147094, 95496),
];

const byNick = (rows) =>
  Object.fromEntries(rows.map((r) => [r.user_nickname, r]));

describe("app/utils/solareMatchScore.js", () => {
  describe(".scoreMatchPlayers()", () => {
    test("scores an exactly-average player as 100", () => {
      expect(SCORE_WEIGHTS.deaths).toBeGreaterThan(0);

      const identical = [true, true, true, false, false, false].map((w, i) =>
        player(`P${i}`, w, 2, 2, 10, 100000, 100000, 100000),
      );
      for (const row of scoreMatchPlayers(identical)) {
        expect(row.score).toBe(100);
      }
    });

    test("picks MVP from the winning team and ACE from the losing team (real match #938114)", () => {
      const result = byNick(scoreMatchPlayers(MATCH_938114));

      expect(result.Skito).toEqual({
        user_nickname: "Skito",
        score: 175,
        award: "mvp",
      });
      expect(result.BahiaSSA).toEqual({
        user_nickname: "BahiaSSA",
        score: 95,
        award: "ace",
      });
      expect(result.MkT.score).toBe(93);
      expect(result.MkT.award).toBeNull();
      expect(result.Shiuu.award).toBeNull();
      expect(result.BeyondTheGraves.award).toBeNull();
      expect(result.Chuvinha.award).toBeNull();
    });

    test("awards exactly one MVP and one ACE", () => {
      const awards = scoreMatchPlayers(MATCH_938114).map((r) => r.award);
      expect(awards.filter((a) => a === "mvp")).toHaveLength(1);
      expect(awards.filter((a) => a === "ace")).toHaveLength(1);
    });

    test("breaks score ties by kills, then damage, then nickname", () => {
      const tied = [
        player("Bravo", true, 2, 1, 10, 100000, 100000, 100000),
        player("Alpha", true, 2, 1, 10, 100000, 100000, 100000),
        player("Carry", true, 0, 1, 10, 100000, 100000, 100000),
        player("L1", false, 1, 3, 10, 100000, 100000, 100000),
        player("L2", false, 1, 3, 10, 100000, 100000, 100000),
        player("L3", false, 0, 3, 10, 100000, 100000, 100000),
      ];
      const result = byNick(scoreMatchPlayers(tied));
      expect(result.Alpha.award).toBe("mvp");
      expect(result.Bravo.award).toBeNull();
      expect(result.L1.award).toBe("ace");
    });

    test("treats a stat nobody has as neutral (no deaths in the match)", () => {
      const flawless = [true, true, true, false, false, false].map((w, i) =>
        player(`P${i}`, w, 1, 0, 10, 100000, 100000, 100000),
      );
      for (const row of scoreMatchPlayers(flawless)) {
        expect(row.score).toBe(100);
      }
    });

    test("returns null score and award when the lobby is incomplete", () => {
      const partial = MATCH_938114.slice(0, 5);
      for (const row of scoreMatchPlayers(partial)) {
        expect(row.score).toBeNull();
        expect(row.award).toBeNull();
      }
      expect(scoreMatchPlayers([])).toEqual([]);
      expect(scoreMatchPlayers(undefined)).toEqual([]);
    });

    test("returns null score and award when teams are not 3 x 3", () => {
      const lopsided = MATCH_938114.map((p, i) => ({ ...p, is_winner: i < 4 }));
      for (const row of scoreMatchPlayers(lopsided)) {
        expect(row.award).toBeNull();
      }
    });
  });
});
