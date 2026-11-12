import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: Bun.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/openlynk" },
  strict: true,
  verbose: true,
});
