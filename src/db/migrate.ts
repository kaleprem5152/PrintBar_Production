import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "path";

async function runMigration() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL environment variable is not defined");
    process.exit(1);
  }

  console.log("Connecting to PostgreSQL...");
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
    console.log("Running Drizzle migrations...");
    const migrationsFolder = path.resolve(process.cwd(), "drizzle");
    await migrate(db, { migrationsFolder });
    console.log("Migrations applied successfully!");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void runMigration();
