export const TIER_BADGES = {
  solare_incarnate_v: "/images/solare/tiers/solare-incarnate-v.png",
  radiant_spear_iv_3: "/images/solare/tiers/radiant-spear-iv-3.png",
  radiant_spear_iv_2: "/images/solare/tiers/radiant-spear-iv-2.png",
  radiant_spear_iv_1: "/images/solare/tiers/radiant-spear-iv-1.png",
  twilight_spear_iii_3: "/images/solare/tiers/twilight-spear-iii-3.png",
  twilight_spear_iii_2: "/images/solare/tiers/twilight-spear-iii-2.png",
  twilight_spear_iii_1: "/images/solare/tiers/twilight-spear-iii-1.png",
  shining_spear_ii_3: "/images/solare/tiers/shining-spear-ii-3.png",
  shining_spear_ii_2: "/images/solare/tiers/shining-spear-ii-2.png",
  shining_spear_ii_1: "/images/solare/tiers/shining-spear-ii-1.png",
  dawn_spear_i_3: "/images/solare/tiers/dawn-spear-i-3.png",
  dawn_spear_i_2: "/images/solare/tiers/dawn-spear-i-2.png",
  dawn_spear_i_1: "/images/solare/tiers/dawn-spear-i-1.png",
  skilled_soldier_4: "/images/solare/tiers/skilled-soldier-4.png",
  skilled_soldier_3: "/images/solare/tiers/skilled-soldier-3.png",
  skilled_soldier_2: "/images/solare/tiers/skilled-soldier-2.png",
  skilled_soldier_1: "/images/solare/tiers/skilled-soldier-1.png",
  apprentice_soldier_4: "/images/solare/tiers/apprentice-soldier-4.png",
  apprentice_soldier_3: "/images/solare/tiers/apprentice-soldier-3.png",
  apprentice_soldier_2: "/images/solare/tiers/apprentice-soldier-2.png",
  apprentice_soldier_1: "/images/solare/tiers/apprentice-soldier-1.png",
  beginner_soldier: "/images/solare/tiers/beginner-soldier.png",
};

export const BDO_CLASSES = {
  0: "Warrior",
  1: "Hashashin",
  2: "Sage",
  3: "Wukong",
  4: "Ranger",
  5: "Guardian",
  6: "Scholar",
  7: "Drakania",
  8: "Sorceress",
  9: "Nova",
  10: "Corsair",
  11: "Lahn",
  12: "Berserker",
  15: "Maegu",
  16: "Tamer",
  17: "Shai",
  19: "Striker",
  20: "Musa",
  21: "Maehwa",
  23: "Mystic",
  24: "Valkyrie",
  25: "Kunoichi",
  26: "Ninja",
  27: "Dark Knight",
  28: "Wizard",
  29: "Archer",
  30: "Woosa",
  31: "Witch",
  32: "Seraph",
  33: "Dosa",
  34: "Deadeye",
  35: "Agent",
};

export const ASCENSION_CLASSES = new Set([3, 6, 17, 29, 32, 34]);

export function getClassName(classType) {
  if (classType === undefined || classType === null) {
    return "Unknown";
  }
  return BDO_CLASSES[Number(classType)] || `Class ${classType}`;
}

export function getSkillBranch(classType, branchType) {
  if (ASCENSION_CLASSES.has(Number(classType))) {
    return "Ascension";
  }
  return Number(branchType) === 1 ? "Awakening" : "Succession";
}

export function getTierInfo(rating, ranking = 999) {
  const numericRating = Number(rating) || 0;
  const numericRanking =
    ranking !== null && ranking !== undefined ? Number(ranking) : 999;

  let tier;
  if (numericRanking >= 1 && numericRanking <= 30 && numericRating >= 2401) {
    tier = {
      name: "Solare Incarnate [V]",
      sub_tier: "2401+ points",
      code: "solare_incarnate_v",
    };
  } else if (numericRating >= 2301) {
    tier = {
      name: "Radiant Spear [IV]",
      sub_tier: "2301 - 2400 points",
      code: "radiant_spear_iv_3",
    };
  } else if (numericRating >= 2201) {
    tier = {
      name: "Radiant Spear [IV]",
      sub_tier: "2201 - 2300 points",
      code: "radiant_spear_iv_2",
    };
  } else if (numericRating >= 2101) {
    tier = {
      name: "Radiant Spear [IV]",
      sub_tier: "2101 - 2200 points",
      code: "radiant_spear_iv_1",
    };
  } else if (numericRating >= 2001) {
    tier = {
      name: "Twilight Spear [III]",
      sub_tier: "2001 - 2100 points",
      code: "twilight_spear_iii_3",
    };
  } else if (numericRating >= 1901) {
    tier = {
      name: "Twilight Spear [III]",
      sub_tier: "1901 - 2000 points",
      code: "twilight_spear_iii_2",
    };
  } else if (numericRating >= 1801) {
    tier = {
      name: "Twilight Spear [III]",
      sub_tier: "1801 - 1900 points",
      code: "twilight_spear_iii_1",
    };
  } else if (numericRating >= 1701) {
    tier = {
      name: "Shining Spear [II]",
      sub_tier: "1701 - 1800 points",
      code: "shining_spear_ii_3",
    };
  } else if (numericRating >= 1601) {
    tier = {
      name: "Shining Spear [II]",
      sub_tier: "1601 - 1700 points",
      code: "shining_spear_ii_2",
    };
  } else if (numericRating >= 1501) {
    tier = {
      name: "Shining Spear [II]",
      sub_tier: "1501 - 1600 points",
      code: "shining_spear_ii_1",
    };
  } else if (numericRating >= 1401) {
    tier = {
      name: "Dawn Spear [I]",
      sub_tier: "1401 - 1500 points",
      code: "dawn_spear_i_3",
    };
  } else if (numericRating >= 1301) {
    tier = {
      name: "Dawn Spear [I]",
      sub_tier: "1301 - 1400 points",
      code: "dawn_spear_i_2",
    };
  } else if (numericRating >= 1201) {
    tier = {
      name: "Dawn Spear [I]",
      sub_tier: "1201 - 1300 points",
      code: "dawn_spear_i_1",
    };
  } else if (numericRating >= 1101) {
    tier = {
      name: "Skilled Soldier",
      sub_tier: "1101 - 1200 points",
      code: "skilled_soldier_4",
    };
  } else if (numericRating >= 1001) {
    tier = {
      name: "Skilled Soldier",
      sub_tier: "1001 - 1100 points",
      code: "skilled_soldier_3",
    };
  } else if (numericRating >= 901) {
    tier = {
      name: "Skilled Soldier",
      sub_tier: "901 - 1000 points",
      code: "skilled_soldier_2",
    };
  } else if (numericRating >= 801) {
    tier = {
      name: "Skilled Soldier",
      sub_tier: "801 - 900 points",
      code: "skilled_soldier_1",
    };
  } else if (numericRating >= 701) {
    tier = {
      name: "Apprentice Soldier",
      sub_tier: "701 - 800 points",
      code: "apprentice_soldier_4",
    };
  } else if (numericRating >= 601) {
    tier = {
      name: "Apprentice Soldier",
      sub_tier: "601 - 700 points",
      code: "apprentice_soldier_3",
    };
  } else if (numericRating >= 501) {
    tier = {
      name: "Apprentice Soldier",
      sub_tier: "501 - 600 points",
      code: "apprentice_soldier_2",
    };
  } else if (numericRating >= 401) {
    tier = {
      name: "Apprentice Soldier",
      sub_tier: "401 - 500 points",
      code: "apprentice_soldier_1",
    };
  } else {
    tier = {
      name: "Beginner Soldier",
      sub_tier: "0 - 400 points",
      code: "beginner_soldier",
    };
  }

  tier.badge_url =
    TIER_BADGES[tier.code] || "/images/solare/tiers/beginner-soldier.png";
  return tier;
}

// Arena of Solare class assets, named after the class (e.g. "dark-knight.png").
const SOLARE_GAME_ASSETS = "/images/solare/game";

export function getClassSlug(classType) {
  if (classType === undefined || classType === null) return null;
  const name = BDO_CLASSES[Number(classType)];
  return name ? name.toLowerCase().replace(/\s+/g, "-") : null;
}

function classAsset(folder, classType) {
  const slug = getClassSlug(classType);
  return slug ? `${SOLARE_GAME_ASSETS}/${folder}/${slug}.png` : null;
}

// Wide ranking-row portrait (450x130).
export function getClassPortrait(classType) {
  return classAsset("portraits", classType);
}

// Match slot portrait (190x80) used in the match history.
export function getClassMatchSlot(classType) {
  return classAsset("match", classType);
}

// Round face avatar (80x80, transparent corners).
export function getClassAvatar(classType) {
  return classAsset("avatars", classType);
}

// White class emblem (50x50, transparent background).
export function getClassIcon(classType) {
  return classAsset("class-icons", classType);
}

// Awakening / Succession / Ascension symbol (34x42).
export function getSkillBranchIcon(classType, branchType) {
  const slug = getClassSlug(classType);
  if (!slug) return null;
  const branch = getSkillBranch(classType, branchType);
  if (branch === "Ascension") {
    return `${SOLARE_GAME_ASSETS}/branch/ascension-${slug}.png`;
  }
  return `${SOLARE_GAME_ASSETS}/branch/${branch.toLowerCase()}.png`;
}
