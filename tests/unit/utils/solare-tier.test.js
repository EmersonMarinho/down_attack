import fs from "node:fs";
import path from "node:path";
import {
  TIER_BADGES,
  getTierInfo,
  getClassName,
  getSkillBranch,
  BDO_CLASSES,
  ASCENSION_CLASSES,
  getClassPortrait,
  getClassMatchSlot,
  getClassAvatar,
  getClassIcon,
  getSkillBranchIcon,
  getClassSlug,
} from "~/app/utils/solareTier.js";

describe("app/utils/solareTier.js", () => {
  describe(".getTierInfo()", () => {
    test("maps all 22 rating brackets to their exact sub-tier code and distinct badge URL", () => {
      const brackets = [
        {
          rating: 2450,
          ranking: 1,
          code: "solare_incarnate_v",
          name: "Solare Incarnate [V]",
          badge: "/images/solare/tiers/solare-incarnate-v.png",
        },
        {
          rating: 2450,
          ranking: 35,
          code: "radiant_spear_iv_3",
          name: "Radiant Spear [IV]",
          badge: "/images/solare/tiers/radiant-spear-iv-3.png",
        },
        {
          rating: 2350,
          ranking: 10,
          code: "radiant_spear_iv_3",
          name: "Radiant Spear [IV]",
          badge: "/images/solare/tiers/radiant-spear-iv-3.png",
        },
        {
          rating: 2250,
          ranking: 45,
          code: "radiant_spear_iv_2",
          name: "Radiant Spear [IV]",
          badge: "/images/solare/tiers/radiant-spear-iv-2.png",
        },
        {
          rating: 2150,
          ranking: 60,
          code: "radiant_spear_iv_1",
          name: "Radiant Spear [IV]",
          badge: "/images/solare/tiers/radiant-spear-iv-1.png",
        },
        {
          rating: 2050,
          ranking: 80,
          code: "twilight_spear_iii_3",
          name: "Twilight Spear [III]",
          badge: "/images/solare/tiers/twilight-spear-iii-3.png",
        },
        {
          rating: 1950,
          ranking: 90,
          code: "twilight_spear_iii_2",
          name: "Twilight Spear [III]",
          badge: "/images/solare/tiers/twilight-spear-iii-2.png",
        },
        {
          rating: 1850,
          ranking: 110,
          code: "twilight_spear_iii_1",
          name: "Twilight Spear [III]",
          badge: "/images/solare/tiers/twilight-spear-iii-1.png",
        },
        {
          rating: 1750,
          ranking: null,
          code: "shining_spear_ii_3",
          name: "Shining Spear [II]",
          badge: "/images/solare/tiers/shining-spear-ii-3.png",
        },
        {
          rating: 1650,
          ranking: null,
          code: "shining_spear_ii_2",
          name: "Shining Spear [II]",
          badge: "/images/solare/tiers/shining-spear-ii-2.png",
        },
        {
          rating: 1550,
          ranking: null,
          code: "shining_spear_ii_1",
          name: "Shining Spear [II]",
          badge: "/images/solare/tiers/shining-spear-ii-1.png",
        },
        {
          rating: 1450,
          ranking: null,
          code: "dawn_spear_i_3",
          name: "Dawn Spear [I]",
          badge: "/images/solare/tiers/dawn-spear-i-3.png",
        },
        {
          rating: 1350,
          ranking: null,
          code: "dawn_spear_i_2",
          name: "Dawn Spear [I]",
          badge: "/images/solare/tiers/dawn-spear-i-2.png",
        },
        {
          rating: 1250,
          ranking: null,
          code: "dawn_spear_i_1",
          name: "Dawn Spear [I]",
          badge: "/images/solare/tiers/dawn-spear-i-1.png",
        },
        {
          rating: 1150,
          ranking: null,
          code: "skilled_soldier_4",
          name: "Skilled Soldier",
          badge: "/images/solare/tiers/skilled-soldier-4.png",
        },
        {
          rating: 1050,
          ranking: null,
          code: "skilled_soldier_3",
          name: "Skilled Soldier",
          badge: "/images/solare/tiers/skilled-soldier-3.png",
        },
        {
          rating: 950,
          ranking: null,
          code: "skilled_soldier_2",
          name: "Skilled Soldier",
          badge: "/images/solare/tiers/skilled-soldier-2.png",
        },
        {
          rating: 850,
          ranking: null,
          code: "skilled_soldier_1",
          name: "Skilled Soldier",
          badge: "/images/solare/tiers/skilled-soldier-1.png",
        },
        {
          rating: 750,
          ranking: null,
          code: "apprentice_soldier_4",
          name: "Apprentice Soldier",
          badge: "/images/solare/tiers/apprentice-soldier-4.png",
        },
        {
          rating: 650,
          ranking: null,
          code: "apprentice_soldier_3",
          name: "Apprentice Soldier",
          badge: "/images/solare/tiers/apprentice-soldier-3.png",
        },
        {
          rating: 550,
          ranking: null,
          code: "apprentice_soldier_2",
          name: "Apprentice Soldier",
          badge: "/images/solare/tiers/apprentice-soldier-2.png",
        },
        {
          rating: 450,
          ranking: null,
          code: "apprentice_soldier_1",
          name: "Apprentice Soldier",
          badge: "/images/solare/tiers/apprentice-soldier-1.png",
        },
        {
          rating: 300,
          ranking: null,
          code: "beginner_soldier",
          name: "Beginner Soldier",
          badge: "/images/solare/tiers/beginner-soldier.png",
        },
      ];

      for (const item of brackets) {
        const result = getTierInfo(item.rating, item.ranking);
        expect(result.code).toBe(item.code);
        expect(result.name).toBe(item.name);
        expect(result.badge_url).toBe(item.badge);
      }
    });

    test("verifies all 22 badge PNG files exist on disk in public/images/solare/tiers/", () => {
      const badgePaths = Object.values(TIER_BADGES);
      expect(new Set(badgePaths).size).toBe(22);

      for (const relativeUrl of badgePaths) {
        const fullPath = path.join(process.cwd(), "public", relativeUrl);
        expect(fs.existsSync(fullPath)).toBe(true);
      }
    });
  });

  describe(".getClassName() & .getSkillBranch()", () => {
    test("resolves BDO class names and specialization branches including Ascension classes", () => {
      expect(getClassName(12)).toBe("Berserker");
      expect(getSkillBranch(12, 2)).toBe("Succession");
      expect(getSkillBranch(12, 1)).toBe("Awakening");

      // Ascension classes (Scholar = 6, Archer = 29, Deadeye = 34)
      expect(getClassName(6)).toBe("Scholar");
      expect(getSkillBranch(6, 1)).toBe("Ascension");
      expect(getClassName(29)).toBe("Archer");
      expect(getSkillBranch(29, 1)).toBe("Ascension");
    });
  });

  describe("in-game class assets", () => {
    const publicFile = (url) => path.join(process.cwd(), "public", url);

    test("every BDO class has portrait, match slot, avatar and class icon files on disk", () => {
      for (const classType of Object.keys(BDO_CLASSES)) {
        for (const url of [
          getClassPortrait(classType),
          getClassMatchSlot(classType),
          getClassAvatar(classType),
          getClassIcon(classType),
        ]) {
          expect(fs.existsSync(publicFile(url))).toBe(true);
        }
      }
    });

    test("every class resolves a skill branch icon that exists on disk", () => {
      for (const classType of Object.keys(BDO_CLASSES)) {
        for (const branchType of [1, 2]) {
          const url = getSkillBranchIcon(classType, branchType);
          expect(fs.existsSync(publicFile(url))).toBe(true);
        }
      }
    });

    test("maps branch icons to awakening, succession and per-class ascension", () => {
      expect(getSkillBranchIcon(12, 1)).toBe(
        "/images/solare/game/branch/awakening.png",
      );
      expect(getSkillBranchIcon(12, 2)).toBe(
        "/images/solare/game/branch/succession.png",
      );
      expect(getSkillBranchIcon(3, 1)).toBe(
        "/images/solare/game/branch/ascension-wukong.png",
      );
      for (const classType of ASCENSION_CLASSES) {
        expect(getSkillBranchIcon(classType, 1)).toBe(
          `/images/solare/game/branch/ascension-${getClassSlug(classType)}.png`,
        );
      }
    });

    test("names files after the class in English", () => {
      expect(getClassAvatar(0)).toBe("/images/solare/game/avatars/warrior.png");
      expect(getClassPortrait(27)).toBe(
        "/images/solare/game/portraits/dark-knight.png",
      );
      expect(getClassIcon(34)).toBe(
        "/images/solare/game/class-icons/deadeye.png",
      );
    });

    test("returns null for unknown classes", () => {
      expect(getClassPortrait(null)).toBeNull();
      expect(getClassAvatar(999)).toBeNull();
      expect(getSkillBranchIcon(undefined, 1)).toBeNull();
    });
  });
});
