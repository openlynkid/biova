import { defineConfig } from "drizzle-kit";

// drizzle-kit runs under Node, where Bun.env is undefined; process.env works in both.
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/biova" },
  strict: true,
  verbose: true,
});
