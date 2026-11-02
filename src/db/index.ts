import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/printbar";


const globalForDb = globalThis as typeof globalThis & {
  __printbarPool?: Pool;
};

export const pool =
  globalForDb.__printbarPool ??
  new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__printbarPool = pool;
}

export const db = drizzle(pool, { schema });
