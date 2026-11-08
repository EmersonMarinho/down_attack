/**
 * Per-match equipment decoded from Arena of Solare replays (`.repz`).
 *
 * - `solare_replay_parses`: one row per replay processed (status + error), so each replay is
 *   downloaded and decoded at most once (failures are retried after a cooldown by the app).
 * - `solare_replay_loadouts`: one row per player of the match, keyed by family name
 *   (`user_nickname`, the same value stored in `solare_match_players`).
 *   `gear` is a 14-entry array of [itemId, crystal1?, crystal2?] (main, sub, awakening, helmet,
 *   armor, gloves, shoes, necklace, earring x2, ring x2, belt, alchemy stone).
 *   `crystal_sets` lists combined crystal set effects found in the replay ({ crystal_id, tier }).
 */
exports.up = (pgm) => {
  pgm.createTable("solare_replay_parses", {
    region: { type: "varchar(8)", notNull: true },
    record_no: { type: "bigint", notNull: true },
    status: { type: "varchar(16)", notNull: true },
    error: { type: "text" },
    parsed_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("timezone('utc', now())"),
    },
  });
  pgm.addConstraint("solare_replay_parses", "solare_replay_parses_pkey", {
    primaryKey: ["region", "record_no"],
  });

  pgm.createTable("solare_replay_loadouts", {
    region: { type: "varchar(8)", notNull: true },
    record_no: { type: "bigint", notNull: true },
    user_nickname: { type: "varchar(64)", notNull: true },
    character_name: { type: "varchar(64)" },
    gear: { type: "jsonb", notNull: true },
    crystal_sets: { type: "jsonb", notNull: true, default: "[]" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("timezone('utc', now())"),
    },
  });
  pgm.addConstraint("solare_replay_loadouts", "solare_replay_loadouts_pkey", {
    primaryKey: ["region", "record_no", "user_nickname"],
  });
};

exports.down = false;
