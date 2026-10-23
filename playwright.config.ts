import { defineConfig, devices } from "@playwright/test"

/**
 * End-to-end acceptance tests. They start an in-memory PostgreSQL (PGlite) and a dev server
 * with their own port and secrets, so they never touch real data.
 *
 * Use a local Chromium-based browser instead of the bundled one with PLAYWRIGHT_CHROMIUM_EXECUTABLE.
 */
const PORT = 3200
const DB_PORT = 54330
export const BROWSER_TIMEZONE = "Asia/Vladivostok"
export const SETUP_TOKEN = "e2e-setup-token"

const env = {
  DATABASE_URL: `postgres://postgres@127.0.0.1:${DB_PORT}/postgres`,
  APP_URL: `http://localhost:${PORT}`,
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-0123456789",
  SETUP_TOKEN,
  FX_PROVIDER: "none",
  DB_POOL_MAX: "1",
  RATE_LIMIT_ENABLED: "false",
  JOBS_ENABLED: "false",
  OIDC_GROUPS_CLAIM: "groups",
  OIDC_USER_GROUP: "app-budget-users",
  OIDC_ADMIN_GROUP: "app-budget-admins",
  PORT: String(PORT),
  HOSTNAME: "127.0.0.1",
  TZ: "UTC",
}

export { env as E2E_ENV }

export default defineConfig({
  testDir: "e2e",
  outputDir: process.env.E2E_OUTPUT_DIR ?? "work/playwright",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: env.APP_URL,
    locale: "ru-RU",
    timezoneId: BROWSER_TIMEZONE,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: [
    {
      command: "tsx scripts/dev-db.ts",
      env: { PGLITE_MEMORY: "1", PGLITE_PORT: String(DB_PORT) },
      port: DB_PORT,
      reuseExistingServer: false,
    },
    {
      // Production build + standalone server: the same artifact the Docker image runs.
      command: "sh scripts/e2e-server.sh",
      env,
      url: `${env.APP_URL}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
})
