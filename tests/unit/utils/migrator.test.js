import { PG_MIGRATE_LOCK_ID } from "node-pg-migrate";
import database from "~/infra/database.js";
import migrator, {
  defaultMigrationsOptions,
  releaseStaleMigrationLocks,
  runMigrationsWithClient,
} from "~/server/utils/migrator.js";

describe("server/utils/migrator", () => {
  test("configures defaultMigrationsOptions with advisoryLockMode set to wait", () => {
    expect(defaultMigrationsOptions.advisoryLockMode).toBe("wait");
    expect(defaultMigrationsOptions.migrationsTable).toBe("pgmigrations");
    expect(defaultMigrationsOptions.direction).toBe("up");
  });

  test("releaseStaleMigrationLocks terminates aborted, stale idle, and stale active sessions only", async () => {
    const queries = [];
    const mockClient = {
      query: async (q) => {
        queries.push(q);
        if (q.text.includes("FROM pg_locks")) {
          return {
            rows: [
              {
                pid: 101,
                state: "idle in transaction (aborted)",
                state_age_seconds: "0.2",
              },
              {
                pid: 102,
                state: "idle",
                state_age_seconds: "12.5",
              },
              {
                pid: 103,
                state: "idle",
                state_age_seconds: "1.0",
              },
              {
                pid: 104,
                state: "active",
                state_age_seconds: "20.0",
              },
              {
                pid: 105,
                state: "active",
                state_age_seconds: "350.0",
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const terminated = await releaseStaleMigrationLocks(mockClient, {
      maxIdleSeconds: 5,
      maxActiveSeconds: 300,
    });

    expect(terminated).toEqual([101, 102, 105]);
    expect(queries).toHaveLength(4);
    expect(queries[1]).toEqual({
      text: "SELECT pg_terminate_backend($1::integer);",
      values: [101],
    });
    expect(queries[2]).toEqual({
      text: "SELECT pg_terminate_backend($1::integer);",
      values: [102],
    });
    expect(queries[3]).toEqual({
      text: "SELECT pg_terminate_backend($1::integer);",
      values: [105],
    });
  });

  test("releaseStaleMigrationLocks returns empty array when query fails", async () => {
    const mockClient = {
      query: async () => {
        throw new Error("permission denied");
      },
    };

    const terminated = await releaseStaleMigrationLocks(mockClient);
    expect(terminated).toEqual([]);
  });

  test("runMigrationsWithClient rolls back and unlocks advisory locks when runner fails", async () => {
    const executedSql = [];
    const mockClient = {
      query: async (sqlOrObj) => {
        const sqlText =
          typeof sqlOrObj === "string" ? sqlOrObj : sqlOrObj?.text || "";
        executedSql.push(sqlText.trim());
        if (sqlText.includes("FROM pg_locks")) {
          return { rows: [] };
        }
        if (sqlText.includes("pg_advisory_lock")) {
          throw new Error("simulated migration error");
        }
        return { rows: [] };
      },
    };

    await expect(
      runMigrationsWithClient(mockClient, { dryRun: false }),
    ).rejects.toThrow("simulated migration error");

    expect(executedSql).toContain("ROLLBACK;");
    expect(executedSql).toContain("SELECT pg_advisory_unlock_all();");
  });

  test("recovers from an orphaned advisory lock held by an aborted session in PostgreSQL", async () => {
    const staleClient = await database.getNewClient();
    staleClient.on("error", () => {});

    try {
      await staleClient.query(
        `SELECT pg_advisory_lock(${PG_MIGRATE_LOCK_ID});`,
      );
      await staleClient.query("BEGIN;");
      await staleClient.query("SELECT 1 / 0;").catch(() => {});

      const pending = await migrator.listPendingMigrations();
      expect(Array.isArray(pending)).toBe(true);
    } finally {
      await staleClient.end().catch(() => {});
    }
  });
});
