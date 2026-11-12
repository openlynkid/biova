import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export * from "./schema";
export type { Database } from "./types";

const connectionString = Bun.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

// One client per process. Configure pool sizes per deployment environment.
const client = postgres(connectionString, { max: Number(Bun.env.DB_POOL_MAX ?? 10), prepare: false });
export const db = drizzle(client, { schema });
export { schema };
export async function closeDatabase() { await client.end({ timeout: 5 }); }
