// Better Auth's own migrator supports the Kysely adapter only, so Drizzle Kit
// owns schema changes. This script applies pending migrations and then asserts
// the Better Auth tables exist, catching a schema that was generated without them.
import postgres from "postgres";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { readEnv } from "@biova/shared";

const requiredAuthTables = ["user", "session", "account", "verification"];
const url = readEnv("DATABASE_URL");
if (!url) throw new Error("DATABASE_URL is required");

const client = postgres(url, { max: 1, prepare: false });
try {
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });

  const rows = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const existing = new Set(rows.map((row) => row.table_name));
  const missing = requiredAuthTables.filter((table) => !existing.has(table));
  if (missing.length > 0) {
    throw new Error(
      `Missing Better Auth tables after migration: ${missing.join(", ")}. Re-run "bun run db:generate".`,
    );
  }
  console.log("Database migrations completed; Better Auth tables verified");
} finally {
  await client.end();
}
