exports.up = (pgm) => {
  pgm.addColumns(
    "solare_matches",
    {
      season: {
        type: "smallint",
        notNull: false,
      },
    },
    { ifNotExists: true },
  );

  pgm.addColumns(
    "solare_players",
    {
      season: {
        type: "smallint",
        notNull: false,
      },
    },
    { ifNotExists: true },
  );

  pgm.createIndex("solare_matches", ["region", "season", "record_no"], {
    name: "solare_matches_region_season_record_no_index",
    ifNotExists: true,
  });

  pgm.createIndex("solare_players", ["region", "season", "user_no"], {
    name: "solare_players_region_season_user_no_index",
    ifNotExists: true,
  });
};

exports.down = false;
