import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import type { Browser, BrowserContext, Page } from "@playwright/test"
import postgres from "postgres"
import { expect, test as base } from "./fixtures"
import { BROWSER_TIMEZONE, E2E_ENV } from "../playwright.config"

export { expect, type Page } from "./fixtures"
export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>
export const updateScreenshots = process.env.UPDATE_SCREENSHOTS === "1"

// Matrix tests reject all console errors, in addition to the shared hydration guard.
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [async ({ page }, use) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
    await use()
    expect(errors).toEqual([])
  }, { auto: true }],
})

export async function withDb<T>(run: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
  const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => {} })
  try { return await run(sql) } finally { await sql.end() }
}

export async function seedDemo(browser: Browser, prefix: string, name: string) {
  // A restarted worker gets fresh data, so one failed case cannot poison later cases.
  const email = `${prefix}-${randomUUID()}@e2e.test`
  const password = "matrix-demo-password-1"
  execFileSync(process.execPath, ["--import", "tsx", "scripts/admin.ts", "create-admin"], {
    env: { ...process.env, ...E2E_ENV, ADMIN_NAME: name, ADMIN_EMAIL: email, ADMIN_PASSWORD: password }, stdio: "pipe",
  })
  const context = await browser.newContext({ serviceWorkers: "block", locale: "ru-RU", timezoneId: BROWSER_TIMEZONE })
  try {
    const response = await context.request.post("/api/auth/sign-in/email", {
      headers: { Origin: E2E_ENV.APP_URL }, data: { email, password },
    })
    expect(response.ok()).toBe(true)
    const page = await context.newPage()
    await page.goto("/onboarding")
    await page.getByLabel("Название", { exact: true }).fill(name)
    await page.getByRole("button", { name: "Создать", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    expect(E2E_ENV.TZ).toBe("UTC")
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(BROWSER_TIMEZONE)
    execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/seed-demo.ts", email], {
      env: { ...process.env, ...E2E_ENV }, stdio: "pipe",
    })
    const owner = await withDb(async (sql) => {
      const [row] = await sql<{ id: string; household_id: string }[]>`select u.id, hm.household_id from users u join household_members hm on hm.user_id=u.id where u.email=${email} and hm.role='owner'`
      if (!row) throw new Error("Synthetic owner is missing")
      return row
    })
    return { ...owner, state: await context.storageState() }
  } finally { await context.close() }
}

export async function screenshot(page: Page, path: string, fullPage = false) {
  if (!updateScreenshots) return
  await mkdir(dirname(path), { recursive: true })
  await page.screenshot({ path, fullPage, animations: "disabled" })
}
