import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function formatDatabaseUrl(raw?: string): string {
  if (!raw) return "postgresql://postgres:postgres@localhost:5432/printbar";
  try {
    new URL(raw);
    return raw;
  } catch {
    const match = raw.match(/^(postgres(?:ql)?:\/\/[^:]+:)(.*)(@[^@]+)$/);
    if (match) {
      const encodedPass = encodeURIComponent(decodeURIComponent(match[2]));
      return `${match[1]}${encodedPass}${match[3]}`;
    }
    return raw;
  }
}

const rawUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/printbar";
const databaseUrl = formatDatabaseUrl(rawUrl);

const globalForDb = globalThis as typeof globalThis & {
  __printbarPool?: Pool;
};

const isRemote = databaseUrl.includes("supabase.co") || databaseUrl.includes("aws-") || databaseUrl.includes("pooler");

export const pool =
  globalForDb.__printbarPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: isRemote ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__printbarPool = pool;
}

export const db = drizzle(pool, { schema });
