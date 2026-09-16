import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const override = process.env.DATABASE_URL_OVERRIDE?.trim();
const primaryConnectionString = override || process.env.DATABASE_URL;
const secondaryConnectionString = process.env.DATABASE_URL_2?.trim();

if (!primaryConnectionString) {
  throw new Error(
    "No database connection string found. Set DATABASE_URL or DATABASE_URL_OVERRIDE.",
  );
}

type DatabaseTarget = "primary" | "secondary";

const primaryPool = new Pool({ connectionString: primaryConnectionString });
const secondaryPool = secondaryConnectionString
  ? new Pool({ connectionString: secondaryConnectionString })
  : undefined;

let activeTarget: DatabaseTarget = "primary";
let lastMonthKey = getMonthKey();

function getMonthKey(date = new Date()): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
}

function activePool(): pg.Pool {
  return activeTarget === "secondary" && secondaryPool
    ? secondaryPool
    : primaryPool;
}

function switchTo(target: DatabaseTarget): void {
  if (target === "secondary" && !secondaryPool) {
    return;
  }

  if (activeTarget !== target) {
    activeTarget = target;
    console.warn(`[db] switched to ${target} database`);
  }
}

async function probePrimary(): Promise<boolean> {
  try {
    await primaryPool.query("select 1");
    switchTo("primary");
    return true;
  } catch {
    return false;
  }
}

async function prepareTarget(): Promise<void> {
  const currentMonthKey = getMonthKey();
  const monthChanged = currentMonthKey !== lastMonthKey;

  if (monthChanged) {
    lastMonthKey = currentMonthKey;
    await probePrimary();
  }
}

async function runQuery(args: unknown[]): Promise<unknown> {
  await prepareTarget();

  try {
    return await activePool().query(...(args as Parameters<pg.Pool["query"]>));
  } catch (error) {
    if (activeTarget !== "primary" || !secondaryPool) {
      throw error;
    }

    switchTo("secondary");
    return secondaryPool.query(...(args as Parameters<pg.Pool["query"]>));
  }
}

async function connect(): Promise<pg.PoolClient> {
  await prepareTarget();

  try {
    return await activePool().connect();
  } catch (error) {
    if (activeTarget !== "primary" || !secondaryPool) {
      throw error;
    }

    switchTo("secondary");
    return secondaryPool.connect();
  }
}

// Drizzle keeps the pool object it receives, so route pool operations through
// the currently healthy target instead of rebuilding every imported db client.
export const pool = new Proxy({} as pg.Pool, {
  get(_target, property) {
    if (property === "query") {
      return (...args: unknown[]) => runQuery(args);
    }

    if (property === "connect") {
      return connect;
    }

    const value = Reflect.get(activePool(), property);
    return typeof value === "function" ? value.bind(activePool()) : value;
  },
});

export const db = drizzle(pool, { schema });

export function getDatabaseStatus(): {
  activeTarget: DatabaseTarget;
  failoverConfigured: boolean;
} {
  return {
    activeTarget,
    failoverConfigured: Boolean(secondaryPool),
  };
}

export * from "./schema";
