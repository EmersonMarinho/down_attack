import database from "~/infra/database.js";

describe("infra/database.js", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("uses max=10 and idleTimeoutMillis=30000 in local non-serverless environment", () => {
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL;
    delete process.env.POSTGRES_MAX_CONNECTIONS;

    const config = database.getPoolConfig();
    expect(config.max).toBe(10);
    expect(config.idleTimeoutMillis).toBe(30000);
    expect(config.connectionTimeoutMillis).toBe(15000);
    expect(config.allowExitOnIdle).toBe(true);
  });

  test("reduces max=1 and idleTimeoutMillis=5000 in Vercel serverless environment", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.POSTGRES_MAX_CONNECTIONS;

    const config = database.getPoolConfig();
    expect(config.max).toBe(1);
    expect(config.idleTimeoutMillis).toBe(5000);
  });

  test("respects explicit POSTGRES_MAX_CONNECTIONS override", () => {
    process.env.VERCEL_ENV = "production";
    process.env.POSTGRES_MAX_CONNECTIONS = "3";

    const config = database.getPoolConfig();
    expect(config.max).toBe(3);
    expect(config.idleTimeoutMillis).toBe(5000);
  });

  test("ignores invalid or non-positive POSTGRES_MAX_CONNECTIONS override", () => {
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL;

    process.env.POSTGRES_MAX_CONNECTIONS = "0";
    expect(database.getPoolConfig().max).toBe(10);

    process.env.POSTGRES_MAX_CONNECTIONS = "-5";
    expect(database.getPoolConfig().max).toBe(10);

    process.env.POSTGRES_MAX_CONNECTIONS = "invalid";
    expect(database.getPoolConfig().max).toBe(10);
  });
});
