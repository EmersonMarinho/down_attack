import { Client, Pool } from "pg";
import { ServiceError } from "./errors.js";

function getSSL() {
  if (process.env.POSTGRES_SSL === "false") {
    return false;
  }
  if (process.env.POSTGRES_SSL === "true") {
    return true;
  }
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV ||
    (process.env.POSTGRES_HOST &&
      process.env.POSTGRES_HOST !== "localhost" &&
      process.env.POSTGRES_HOST !== "127.0.0.1")
  ) {
    return true;
  }
  return false;
}

function getDatabaseCredentials() {
  return {
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    ssl: getSSL(),
  };
}

let pool;

function isServerlessEnvironment() {
  return Boolean(process.env.VERCEL_ENV || process.env.VERCEL);
}

function getPoolConfig() {
  const serverless = isServerlessEnvironment();
  const explicitMax = Number(process.env.POSTGRES_MAX_CONNECTIONS);
  const max =
    Number.isInteger(explicitMax) && explicitMax > 0
      ? explicitMax
      : serverless
        ? 1
        : 10;

  return {
    ...getDatabaseCredentials(),
    max,
    idleTimeoutMillis: serverless ? 5000 : 30000,
    connectionTimeoutMillis: 15000,
    allowExitOnIdle: true,
  };
}

function getPool() {
  if (!pool) {
    pool = new Pool(getPoolConfig());
  }
  return pool;
}

async function query(queryObject) {
  // In the Jest runner process (orchestrator), use an ephemeral connection to avoid
  // holding an idle connection alongside the Nuxt server or hanging under jest.useFakeTimers().
  if (process.env.JEST_WORKER_ID) {
    let client;
    try {
      client = await getNewClient();
      const res = await client.query(queryObject);
      return res;
    } catch (error) {
      const serviceErrorObject = new ServiceError({
        message: "Error on connection with the Database or on the Query.",
        cause: error,
      });
      throw serviceErrorObject;
    } finally {
      await client?.end();
    }
  }

  try {
    const activePool = getPool();
    const res = await activePool.query(queryObject);
    return res;
  } catch (error) {
    const serviceErrorObject = new ServiceError({
      message: "Error on connection with the Database or on the Query.",
      cause: error,
    });
    throw serviceErrorObject;
  }
}

async function getNewClient() {
  const client = new Client(getDatabaseCredentials());
  await client.connect();
  return client;
}

const database = {
  query,
  getNewClient,
  getPoolConfig,
};

export default database;
