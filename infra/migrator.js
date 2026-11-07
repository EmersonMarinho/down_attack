import { PG_MIGRATE_LOCK_ID, runner } from "node-pg-migrate";
import { resolve } from "node:path";

export const defaultMigrationsOptions = {
  dryRun: true,
  dir: resolve("infra", "migrations"),
  direction: "up",
  log: () => {},
  migrationsTable: "pgmigrations",
  advisoryLockMode: "wait",
};

export async function releaseStaleMigrationLocks(
  dbClient,
  {
    lockId = PG_MIGRATE_LOCK_ID,
    maxIdleSeconds = 5,
    maxActiveSeconds = 300,
  } = {},
) {
  try {
    const { rows } = await dbClient.query({
      text: `
        SELECT
          l.pid,
          a.state,
          EXTRACT(
            EPOCH FROM (
              clock_timestamp() - COALESCE(a.state_change, a.query_start, a.backend_start)
            )
          ) AS state_age_seconds
        FROM pg_locks l
        JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory'
          AND l.objsubid = 1
          AND l.granted = TRUE
          AND ((l.classid::bigint << 32) | l.objid::bigint) = $1::bigint
          AND l.pid <> pg_backend_pid();
      `,
      values: [String(lockId)],
    });

    const terminatedPids = [];

    for (const row of rows) {
      const state = row.state || "";
      const ageSeconds = Number(row.state_age_seconds) || 0;
      const isAbortedTransaction = state === "idle in transaction (aborted)";
      const isStaleIdle =
        (state === "idle" ||
          state === "idle in transaction" ||
          state === "disabled") &&
        ageSeconds >= maxIdleSeconds;
      const isStaleActive =
        state === "active" && ageSeconds >= maxActiveSeconds;

      if (isAbortedTransaction || isStaleIdle || isStaleActive) {
        await dbClient.query({
          text: "SELECT pg_terminate_backend($1::integer);",
          values: [row.pid],
        });
        terminatedPids.push(row.pid);
      }
    }

    return terminatedPids;
  } catch {
    return [];
  }
}

export async function runMigrationsWithClient(dbClient, options = {}) {
  await releaseStaleMigrationLocks(dbClient);

  try {
    return await runner({
      ...defaultMigrationsOptions,
      ...options,
      dbClient,
    });
  } catch (error) {
    await dbClient.query("ROLLBACK;").catch(() => {});
    throw error;
  } finally {
    await dbClient.query("SELECT pg_advisory_unlock_all();").catch(() => {});
  }
}
