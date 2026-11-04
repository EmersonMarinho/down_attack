// Performance score and MVP / ACE awards for an Arena of Solare match.
//
// Each stat is compared with the average of the 6 players in the same match
// (1.0 = match average), so short 3-0 stomps and long 3-2 games are comparable.
// The weighted sum is scaled so that an average performance scores 100.
//
// MVP = best score on the winning team, ACE = best score on the losing team.
// Ties are broken by kills, then damage done, then nickname (deterministic).

export const SCORE_WEIGHTS = Object.freeze({
  kills: 0.3,
  damage_done: 0.3,
  cc: 0.2,
  recovery: 0.05,
  damage_taken: 0.05,
  deaths: 0.1,
});

const PLAYERS_PER_MATCH = 6;
// Sum of the positive weights: dividing by it makes an exactly-average player score 100.
const POSITIVE_WEIGHT_SUM =
  SCORE_WEIGHTS.kills +
  SCORE_WEIGHTS.damage_done +
  SCORE_WEIGHTS.cc +
  SCORE_WEIGHTS.recovery +
  SCORE_WEIGHTS.damage_taken;

function toStats(player) {
  return {
    kills: Number(player.kill_count || 0),
    deaths: Number(player.death_count || 0),
    cc: Number(player.cc_applied_count || 0),
    damage_done: Number(player.damage_done || 0),
    damage_taken: Number(player.damage_taken || 0),
    recovery: Number(player.recovery || 0),
  };
}

function compareForAward(a, b) {
  return (
    b.score - a.score ||
    b.stats.kills - a.stats.kills ||
    b.stats.damage_done - a.stats.damage_done ||
    a.user_nickname.localeCompare(b.user_nickname)
  );
}

/**
 * @param {Array<object>} players rows of solare_match_players for ONE match
 *   (user_nickname, is_winner, kill_count, death_count, cc_applied_count,
 *   damage_done, damage_taken, recovery).
 * @returns {Array<{user_nickname: string, score: number|null, award: "mvp"|"ace"|null}>}
 *   Scores and awards are null when the lobby is incomplete (not 3 winners x 3 losers),
 *   because averages over a partial lobby would be misleading.
 */
export function scoreMatchPlayers(players) {
  const list = Array.isArray(players) ? players : [];
  const winners = list.filter((p) => p.is_winner === true).length;
  const losers = list.filter((p) => p.is_winner === false).length;

  if (
    list.length !== PLAYERS_PER_MATCH ||
    winners !== PLAYERS_PER_MATCH / 2 ||
    losers !== PLAYERS_PER_MATCH / 2
  ) {
    return list.map((p) => ({
      user_nickname: p.user_nickname,
      score: null,
      award: null,
    }));
  }

  const withStats = list.map((p) => ({
    user_nickname: String(p.user_nickname || ""),
    is_winner: p.is_winner === true,
    stats: toStats(p),
  }));

  const keys = Object.keys(withStats[0].stats);
  const averages = {};
  for (const key of keys) {
    averages[key] =
      withStats.reduce((sum, p) => sum + p.stats[key], 0) / withStats.length;
  }
  // 1.0 = match average; when nobody has the stat (e.g. no deaths), everyone is neutral.
  const relative = (p, key) =>
    averages[key] > 0 ? p.stats[key] / averages[key] : 1;

  const scored = withStats.map((p) => ({
    ...p,
    score: Math.round(
      (100 *
        (SCORE_WEIGHTS.kills * relative(p, "kills") +
          SCORE_WEIGHTS.damage_done * relative(p, "damage_done") +
          SCORE_WEIGHTS.cc * relative(p, "cc") +
          SCORE_WEIGHTS.recovery * relative(p, "recovery") +
          SCORE_WEIGHTS.damage_taken * relative(p, "damage_taken") -
          SCORE_WEIGHTS.deaths * (relative(p, "deaths") - 1))) /
        POSITIVE_WEIGHT_SUM,
    ),
  }));

  const mvp = scored.filter((p) => p.is_winner).sort(compareForAward)[0];
  const ace = scored.filter((p) => !p.is_winner).sort(compareForAward)[0];

  return scored.map((p) => ({
    user_nickname: p.user_nickname,
    score: p.score,
    award: p === mvp ? "mvp" : p === ace ? "ace" : null,
  }));
}
