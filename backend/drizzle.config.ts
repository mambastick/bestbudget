import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./src/bestbudget/infrastructure/database/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://bestbudget:bestbudget@localhost:5432/bestbudget",
  },
  strict: true,
  verbose: true,
})
