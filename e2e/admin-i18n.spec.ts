import { execFileSync } from "node:child_process"
import { mkdir } from "node:fs/promises"
import postgres from "postgres"
import { expect, test } from "@playwright/test"
import { E2E_ENV } from "../playwright.config"

const demo = { name: "Алексей Demo Admin", email: "admin-locale@e2e.test", password: "admin-locale-password-1" }
const routes = ["users", "households", "auth", "rates", "events", "notifications"] as const
const screenshots = "docs/screenshots/i18n/admin"

test("administration: seed demo in ru/en, 1280/375px and light/dark", async ({ browser }, testInfo) => {
  test.setTimeout(240_000)
  execFileSync(process.execPath, ["--import", "tsx", "scripts/admin.ts", "create-admin"], {
    env: { ...process.env, ...E2E_ENV, ADMIN_NAME: demo.name, ADMIN_EMAIL: demo.email, ADMIN_PASSWORD: demo.password },
  })
  const context = await browser.newContext({ locale: "ru-RU", colorScheme: "light", viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1 })
  await mkdir(screenshots, { recursive: true })
  try {
    await page.goto("/login")
    await page.getByLabel("E-mail").fill(demo.email)
    await page.getByLabel("Пароль", { exact: true }).fill(demo.password)
    await page.getByRole("button", { name: "Войти", exact: true }).click()
    await expect(page).toHaveURL(/\/onboarding/)
    await page.getByLabel("Название").fill("Семья Demo Admin")
    await page.getByRole("button", { name: "Создать", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/seed-demo.ts", demo.email], { env: { ...process.env, ...E2E_ENV } })
    const [profile] = await sql`select id, locale, last_seen_locale from users where email = ${demo.email}`
    expect(profile).toMatchObject({ locale: null, last_seen_locale: "ru" })
    await sql`insert into notification_deliveries (user_id, household_id, channel, kind, dedupe_key, status, error) select ${profile!.id}, household_id, 'telegram', 'due', 'synthetic-locale-error', 'unknown', 'delivery_unknown' from household_members where user_id = ${profile!.id} limit 1`

    for (const locale of ["ru", "en"] as const) {
      // Use the real preference action; browser fallback must be remembered separately.
      await page.goto("/settings?tab=profile")
      await page.getByRole("radiogroup", { name: "Язык", exact: true }).getByRole("radio", { name: locale === "ru" ? "Русский" : "English", exact: true }).click()
      await expect(page.locator("html")).toHaveAttribute("lang", locale)
      const [saved] = await sql`select locale, last_seen_locale from users where id = ${profile!.id}`
      expect(saved).toMatchObject({ locale, last_seen_locale: "ru" })
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => localStorage.setItem("theme", value), theme)
        for (const width of [1280, 375]) {
          await page.setViewportSize({ width, height: 900 })
          for (const tab of routes) {
            await page.goto(`/admin?tab=${tab}`)
            await expect(page).toHaveTitle(`${locale === "ru" ? "Администрирование" : "Administration"} · BestBudget`)
            await expect(page.locator("html")).toHaveClass(new RegExp(theme))
            await expect(page.getByRole("heading", { name: locale === "ru" ? "Администрирование" : "Administration", exact: true })).toBeVisible()
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
            await expect(page.locator("nextjs-portal")).toHaveCount(0)
            if (tab === "users") await expect(page.getByText(demo.name, { exact: false }).first()).toBeVisible()
            if (tab === "notifications") await expect(page.getByText(locale === "ru" ? "Ошибок пока нет" : "No errors yet")).toHaveCount(0)
            await page.screenshot({ path: testInfo.outputPath(`${locale}-${theme}-${width}-${tab}.png`), animations: "disabled" })
            if (locale === "en" && ((tab === "users" && theme === "light" && width === 1280) || (tab === "auth" && theme === "dark" && width === 375) || (tab === "notifications" && theme === "light" && width === 375))) {
              await page.screenshot({ path: `${screenshots}/${tab}-en-${width}-${theme}.png`, fullPage: tab !== "users", animations: "disabled" })
            }
          }
        }
      }
    }
    expect(errors).toEqual([])
  } finally { await sql.end(); await context.close() }
})
