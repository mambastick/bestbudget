import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import postgres from "postgres"
import { E2E_ENV, SETUP_TOKEN } from "../../playwright.config"
import { addDays, todayIn } from "../../src/lib/dates"

const DIR = "docs/screenshots/multicurrency"
const DEMO = { name: "Демо BestBudget", email: "screenshots@bestbudget.test", password: "screenshots-password-1" }

async function capture(page: Page, file: string, fullPage = true) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `${DIR}/${file}.png`, fullPage, animations: "disabled" })
}

test("captures multicurrency on the actual seed-demo dataset", async ({ page }) => {
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
  await expect(dialog.getByText(/Эффективный курс/)).toBeVisible()
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
  await expect(page.getByRole("status").filter({ hasText: "Курсы валют" })).toContainText("курс от")
  await capture(page, "dashboard-desktop")

  await page.goto("/admin?tab=rates")
  await expect(page.getByRole("button", { name: "Сохранить ручной курс" })).toBeVisible()
  await expect(page.getByText(`${at} · USD · ручной`, { exact: true })).toBeVisible()
  await capture(page, "rates-admin-desktop")
})
