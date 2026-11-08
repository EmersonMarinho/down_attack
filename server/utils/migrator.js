import database from "~~/infra/database.js";
import {
  defaultMigrationsOptions,
  releaseStaleMigrationLocks,
  runMigrationsWithClient,
} from "~~/infra/migrator.js";

export {
  defaultMigrationsOptions,
  releaseStaleMigrationLocks,
  runMigrationsWithClient,
};

async function listPendingMigrations() {
  let dbClient;

  try {
    dbClient = await database.getNewClient();

    return await runMigrationsWithClient(dbClient, {
      dryRun: true,
    });
  } finally {
    await dbClient?.end();
  }
}

async function runPendingMigrations() {
  let dbClient;
  try {
    dbClient = await database.getNewClient();

    return await runMigrationsWithClient(dbClient, {
      dryRun: false,
    });
  } finally {
    await dbClient?.end();
  }
}

const migrator = {
  defaultMigrationsOptions,
  releaseStaleMigrationLocks,
  runMigrationsWithClient,
  listPendingMigrations,
  runPendingMigrations,
};

export default migrator;
