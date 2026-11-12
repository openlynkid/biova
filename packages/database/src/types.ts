import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { TablesRelationalConfig } from "drizzle-orm/relations";

// Both drivers the platform uses (postgres-js in production, PGlite in tests)
// share PgQueryResultHKT, so domain repositories accept this supertype and work
// against either without a cast. The schema is intentionally left open: the
// repositories only need the tables they import directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = PgDatabase<PgQueryResultHKT, any, TablesRelationalConfig>;
