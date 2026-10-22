import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import postgres from "postgres"
import { E2E_ENV, SETUP_TOKEN } from "../../playwright.config"
import { addDays, formatDateFull, formatDay, todayIn } from "../../src/lib/dates"

const DIR = "docs/screenshots/multicurrency"
const DEMO = { name: "Демо BestBudget", email: "screenshots@bestbudget.test", password: "screenshots-password-1" }

async function capture(page: Page, file: string, fullPage = true) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page).toHaveTitle(/BestBudget/)
  await expect(page.locator("main").last()).toBeVisible()
  await expect(page.locator("nextjs-portal")).toHaveCount(0)
  const heroAmount = page.getByTestId("actual-balance").locator("span[aria-label]").first()
  if (await heroAmount.count()) await expect(heroAmount).toHaveText((await heroAmount.getAttribute("aria-label"))!)
  await page.screenshot({ path: `${DIR}/${file}.png`, fullPage, animations: "disabled" })
}

test("captures multicurrency on the actual seed-demo dataset", async ({ page }) => {
  const browserErrors: string[] = []
  page.on("pageerror", (error) => browserErrors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()) })
  mkdirSync(DIR, { recursive: true })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto("/setup")
  await page.getByLabel("Токен настройки").fill(SETUP_TOKEN)
  await page.getByLabel("Имя").fill(DEMO.name)
  await page.getByLabel("E-mail").fill(DEMO.email)
  await page.getByLabel("Пароль", { exact: true }).fill(DEMO.password)
  await page.getByLabel("Повторите пароль").fill(DEMO.password)
  await page.getByRole("button", { name: "Создать администратора" }).click()
  await expect(page).toHaveURL(/\/onboarding/)
  await page.getByLabel("Название").fill("Семейный бюджет · Демо")
  await page.getByRole("button", { name: "Создать", exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/seed-demo.ts", DEMO.email], {
    env: { ...process.env, ...E2E_ENV }, encoding: "utf8",
  })
  const today = todayIn("Europe/Moscow")
  const at = addDays(today, -3)
  const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    // Test-only cached publications and a same-day manual override. FX_PROVIDER=none forbids real CBR calls.
    await sql`insert into exchange_rates(currency, date, rate_to_rub, source) values
      ('USD', ${addDays(today, -40)}, 95, 'cbr'), ('EUR', ${addDays(today, -40)}, 100, 'cbr'),
      ('USD', ${at}, 95, 'cbr'), ('EUR', ${at}, 100, 'cbr'), ('USD', ${at}, 96, 'manual')`
  } finally {
    await sql.end()
  }

  await page.goto("/accounts")
  await expect(page.getByRole("listitem").filter({ hasText: "USD-накопления" })).toContainText("200 $")
  await capture(page, "accounts-desktop")

  await page.getByRole("button", { name: "Перевод", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("combobox").filter({ hasText: "Выберите счёт" }).click()
  await page.getByRole("option", { name: "USD-накопления · USD", exact: true }).click()
  await dialog.getByLabel("Сумма", { exact: true }).fill("9500")
  await expect(dialog.getByLabel("Зачислено", { exact: true })).toHaveValue("98,96")
  await dialog.getByLabel("Зачислено", { exact: true }).fill("100")
  await dialog.getByLabel("Название", { exact: true }).fill("Валютный резерв")
  await expect(dialog.getByText(`1 USD = 96,00 ₽ · ручной курс на ${formatDay(at)}`, { exact: true })).toBeVisible()
  await expect(dialog.getByText("1 USD = 95,00 ₽ · по суммам перевода", { exact: true })).toBeVisible()
  await capture(page, "transfer-desktop", false)
  await page.setViewportSize({ width: 375, height: 1100 })
  await capture(page, "transfer-375", false)
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click()

  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto("/dashboard")
  const hero = page.getByTestId("actual-balance")
  await expect(hero).toHaveCount(1)
  const amount = hero.locator("span[aria-label]").first()
  await expect(amount).toHaveText((await amount.getAttribute("aria-label"))!)
  await expect(page.getByRole("status").filter({ hasText: "Итоги неполные" })).toHaveCount(0)
  await expect(hero).toContainText("2 валютных счёта")
  await expect(hero).not.toContainText("курс от")
  await capture(page, "dashboard-desktop")

  await page.goto("/admin?tab=rates")
  await expect(page.getByRole("button", { name: "Сохранить ручной курс" })).toBeVisible()
  await expect(page.getByText(`${formatDateFull(at)} · USD · ручной`, { exact: true })).toBeVisible()
  await capture(page, "rates-admin-desktop")

  const db = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    await db`update exchange_rates set date = ${addDays(today, -8)} where date = ${at}`
    await page.goto("/dashboard")
    await expect(hero.getByText(`USD: курс от ${formatDay(addDays(today, -8))} (ручной)`, { exact: true })).toHaveCount(1)
    await expect(hero.getByText(`EUR: курс от ${formatDay(addDays(today, -8))} (ЦБ)`, { exact: true })).toHaveCount(1)
    await expect(page.getByRole("status").filter({ hasText: "Итоги неполные" })).toHaveCount(0)
    await capture(page, "dashboard-stale")
    await db`delete from exchange_rates where currency = 'EUR'`
    await page.reload()
    const warning = page.getByRole("status").filter({ hasText: "Итоги неполные" })
    await expect(warning).toContainText("Нет курса EUR.")
    await expect(warning.getByRole("link", { name: "Указать курс" })).toHaveAttribute("href", "/admin?tab=rates")
    await capture(page, "dashboard-missing")
    await db`insert into users(name, email, role) values ('Test administrator', 'remaining-admin@bestbudget.test', 'admin')`
    await db`update users set role = 'user' where email = ${DEMO.email}`
    // Re-authenticate so the non-admin view uses a fresh session.
    await page.context().clearCookies()
    await page.goto("/login")
    await page.getByLabel("E-mail").fill(DEMO.email)
    await page.getByLabel("Пароль", { exact: true }).fill(DEMO.password)
    await page.getByRole("button", { name: "Войти", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(warning).toContainText("Обратитесь к администратору")
    await expect(warning.getByRole("link", { name: "Указать курс" })).toHaveCount(0)
  } finally {
    await db.end()
  }
  expect(browserErrors).toEqual([])
})
