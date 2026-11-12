import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

// Spins up an in-process Postgres (PGlite) with the real migrations applied.
// This lets repository and service tests exercise actual SQL without a server,
// which is what CI runs. Use the same helper against a live server by passing a
// postgres-js database instead.
export async function createTestDatabase() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  return { db, close: () => client.close() };
}

let userSequence = 0;

// Creators reference an auth user, so tests need a real user row first.
export async function createTestUser(db: Awaited<ReturnType<typeof createTestDatabase>>["db"], overrides: Partial<{ id: string; email: string; name: string }> = {}) {
  userSequence += 1;
  const [row] = await db
    .insert(schema.user)
    .values({
      id: overrides.id ?? `user-${userSequence}-${Math.random().toString(36).slice(2, 8)}`,
      email: overrides.email ?? `user-${userSequence}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      name: overrides.name ?? "Test User",
    })
    .returning();
  return row;
}
