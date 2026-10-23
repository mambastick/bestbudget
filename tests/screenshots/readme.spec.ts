import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { expect, test } from "@playwright/test"
import postgres from "postgres"
import { E2E_ENV, SETUP_TOKEN } from "../../playwright.config"

const DEMO = { name: "Алексей Морозов", email: "readme@bestbudget.test", password: "readme-demo-password-1" }
const DIR = "docs/screenshots/readme"
const ROUTES = [
  "/dashboard", "/transactions", "/transactions?tab=rules", "/calendar", "/budgets", "/goals", "/loans", "/loans/new", "/analytics", "/accounts",
  "/settings", "/settings?tab=categories", "/settings?tab=profile", "/admin", "/admin?tab=households", "/admin?tab=auth", "/admin?tab=rates", "/admin?tab=events", "/admin?tab=notifications",
]

test("seed-demo: README captures and all pages at 1280/375 in both themes", async ({ page }, testInfo) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
  mkdirSync(DIR, { recursive: true })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/setup")
  if (page.url().includes("/setup")) {
    await page.getByLabel("Токен настройки").fill(SETUP_TOKEN)
    await page.getByLabel("Имя").fill(DEMO.name)
    await page.getByLabel("E-mail").fill(DEMO.email)
    await page.getByLabel("Пароль", { exact: true }).fill(DEMO.password)
    await page.getByLabel("Повторите пароль").fill(DEMO.password)
    await page.getByRole("button", { name: "Создать администратора" }).click()
  } else {
    // Another screenshot suite may already have completed first-run setup in this isolated database.
    execFileSync(process.execPath, ["--import", "tsx", "scripts/admin.ts", "create-admin"], {
      env: { ...process.env, ...E2E_ENV, ADMIN_NAME: DEMO.name, ADMIN_EMAIL: DEMO.email, ADMIN_PASSWORD: DEMO.password },
    })
    await page.goto("/login")
    await page.getByLabel("E-mail").fill(DEMO.email)
    await page.getByLabel("Пароль", { exact: true }).fill(DEMO.password)
    await page.getByRole("button", { name: "Войти", exact: true }).click()
  }
  await expect(page).toHaveURL(/\/onboarding/)
  await page.getByLabel("Название").fill("Семья Морозовых")
  await page.getByRole("button", { name: "Создать", exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  const args = ["--conditions=react-server", "--import", "tsx", "scripts/seed-demo.ts", DEMO.email]
  execFileSync(process.execPath, args, { env: { ...process.env, ...E2E_ENV } })
  const retry = spawnSync(process.execPath, args, { env: { ...process.env, ...E2E_ENV }, encoding: "utf8" })
  expect(retry.status).toBe(1)
  expect(retry.stderr).toContain("seed-demo requires an empty RUB household")
  const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1 })
  try {
    const [history] = await sql`select count(distinct substring(date::text, 1, 7))::int as months from transactions where status = 'posted'`
    expect(history!.months).toBe(6)
  } finally { await sql.end() }

  await page.goto("/loans")
  const mortgage = await page.getByRole("link", { name: "Семейная ипотека", exact: true }).getAttribute("href")
  await page.goto("/goals")
  const vacation = await page.getByRole("link", { name: "Семейный отпуск", exact: true }).getAttribute("href")
  const routes = [...ROUTES, mortgage!, vacation!]
  const audit: { route: string; width: number; theme: string; overflow: string[]; isoDates: string[] }[] = []
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => localStorage.setItem("theme", theme), theme)
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: width === 375 ? 1000 : 960 })
      for (const route of routes) {
        await page.goto(route)
        await expect(page.locator("html")).toHaveClass(new RegExp(theme))
        await expect(page.getByRole("main").last()).toBeVisible()
        await expect(page.locator("nextjs-portal")).toHaveCount(0)
        if (route === "/dashboard") {
          const money = page.getByTestId("actual-balance").locator("span[aria-label]").first()
          await expect(money).toHaveText(/\d,\d{2}\s₽/)
          await expect(money).not.toHaveText(/\d\.\d{2}\s₽/)
        }
        if (route === "/goals") {
          const emergency = page.getByTestId("goal-card").filter({ hasText: "Подушка безопасности", visible: true })
          await expect(emergency).toContainText("Без срока")
          expect((await emergency.innerText()).match(/Без срока/g)).toHaveLength(1)
        }
        await page.mouse.move(0, 0)
        // Allow JS chart animations to settle before capture.
        await page.waitForTimeout(350)
        const finding = await page.evaluate(() => ({
          overflow: [...document.querySelectorAll("main *")].filter((e) => {
            const r = e.getBoundingClientRect()
            const clip = e.closest('.overflow-x-auto, .overflow-hidden, [data-slot="chart-container"]')
            return !clip && r.width > 0 && (r.right > innerWidth + 1 || r.left < -1)
          }).map((e) => `${e.tagName}.${e.className}: ${e.textContent?.slice(0, 60)}`).slice(0, 15),
          isoDates: document.querySelector("main")?.innerText.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [],
          scrollWidth: document.documentElement.scrollWidth,
        }))
        audit.push({ route, width, theme, overflow: finding.overflow, isoDates: finding.isoDates })
        expect.soft(finding.scrollWidth, `${theme} ${width} ${route}`).toBeLessThanOrEqual(width)
        expect.soft(finding.isoDates, `${theme} ${width} ${route}: ISO dates`).toEqual([])
        const slug = route.replaceAll(/[/?=]/g, "-")
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${width}${slug}.png`), fullPage: true, animations: "disabled" })
        const readme = theme === "light" ? width === 1280
          ? route === "/dashboard" ? "dashboard" : route === "/calendar" ? "calendar" : route === mortgage ? "loan" : null
          : route === "/goals" ? "goals-mobile" : null
          : width === 1280 && route === "/calendar" ? "calendar-dark" : width === 375 && route === "/goals" ? "goals-mobile-dark" : null
        if (readme) await page.screenshot({ path: `${DIR}/${readme}.png`, fullPage: readme === "dashboard" || readme.startsWith("goals-mobile"), animations: "disabled" })
      }
    }
  }
  await testInfo.attach("layout-audit", { body: JSON.stringify(audit, null, 2), contentType: "application/json" })
  expect(errors).toEqual([])
})
