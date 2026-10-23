import { test, expect, seedDemo, withDb, screenshot, type StorageState, type Page } from "./matrix"
import { todayIn } from "../src/lib/dates"

const screenshotDir = "docs/screenshots/i18n/assets-import"
let state: StorageState
let owner: { id: string; household_id: string }
let goal: { id: string }
let loanId: string
let batchUrl: string
let routes: string[]

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
async function closeDialog(page: Page) {
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

test.use({ serviceWorkers: "block", reducedMotion: "reduce" })
test.setTimeout(60_000)

test.beforeAll(async ({ browser }) => {
  const seeded = await seedDemo(browser, "assets-i18n", "Assets i18n demo")
  owner = seeded
  const context = await browser.newContext({ serviceWorkers: "block", storageState: seeded.state })
  try {
    const page = await context.newPage()
    await withDb(async (db) => {
      const [loan] = await db<{ id: string }[]>`select id from loans where household_id=${owner.household_id} order by created_at limit 1`
      const [seedGoal] = await db<{ id: string }[]>`select id from goals where household_id=${owner.household_id} and name='Семейный отпуск'`
      if (!loan || !seedGoal) throw new Error("Seed demo is incomplete")
      loanId = loan.id
      goal = seedGoal
      const today = todayIn("Europe/Moscow")
      const csv = [
        "account;date;amount;currency;description;status;mcc",
        `Накопительный;${today};-123.45;RUB;Synthetic purchase;posted;5411`,
        `Накопительный;${today};-12.34;RUB;Synthetic hold;pending;5411`,
        `Накопительный;${today};-9.87;RUB;Synthetic rejected;rejected;5411`,
        "",
      ].join("\r\n")
      await page.goto("/transactions/import")
      await page.getByLabel("Выписка CSV / XLSX").setInputFiles({ name: "assets.csv", mimeType: "text/csv", buffer: Buffer.from(csv) })
      await page.getByRole("button", { name: "Прочитать файл", exact: true }).click()
      await page.getByRole("button", { name: "Подготовить предпросмотр", exact: true }).click()
      await expect(page).toHaveURL(/batch=/)
      batchUrl = page.url()
      routes = [
        "/accounts",
        "/loans",
        "/loans/new",
        `/loans/${loan.id}`,
        "/goals",
        `/goals/${seedGoal.id}`,
        "/transactions/import",
        batchUrl,
      ]
    })
    state = await context.storageState()
  } finally { await context.close() }
})

test.beforeEach(async ({ context }) => { await context.addCookies(state.cookies) })

for (const locale of ["ru", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1280, 375]) {
      test(`assets and import: ${locale}, ${theme}, ${width}px`, async ({ page }) => {
        await withDb(async (db) => { await db`update users set locale=${locale} where id=${owner.id}` })
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
        await page.addInitScript((value) => localStorage.setItem("theme", value), theme)
        for (const route of routes) {
          await page.goto(route)
          await expect(page.locator("html")).toHaveAttribute("lang", locale)
          await expect(page.locator("html")).toHaveClass(new RegExp(theme))
          await noOverflow(page)
          if (route === "/accounts") {
            await expect(page.getByText(locale === "en" ? "How to track a credit card" : "Как учитывать кредитную карту").filter({ visible: true })).toBeVisible()
            await page.getByRole("button", { name: locale === "en" ? "Account" : "Счёт", exact: true }).click()
            await expect(page.getByRole("dialog")).toContainText(locale === "en" ? "New account" : "Новый счёт")
            await noOverflow(page)
            await closeDialog(page)
          }
          if (route === "/goals") {
            await page.getByRole("button", { name: locale === "en" ? "Create goal" : "Создать цель", exact: true }).click()
            await noOverflow(page)
            await closeDialog(page)
          }
          if (route === `/loans/${loanId}`) {
            await page.getByRole("button", { name: locale === "en" ? "Prepayment" : "Досрочное погашение", exact: true }).click()
            await noOverflow(page)
            await closeDialog(page)
          }
          if (locale === "en" && theme === "dark" && width === 1280 && route === `/loans/${loanId}`)
            await screenshot(page, `${screenshotDir}/loans-en-desktop-dark.png`, false)
          if (locale === "en" && theme === "light" && width === 375 && route === `/goals/${goal.id}`)
            await screenshot(page, `${screenshotDir}/goal-en-375-light.png`, true)
          if (locale === "en" && theme === "dark" && width === 375 && route === batchUrl)
            await screenshot(page, `${screenshotDir}/import-en-375-dark.png`, true)
        }
      })
    }
  }
}

test("assets: English actions and persisted import warnings", async ({ page }) => {
  await withDb(async (db) => {
    await db`update users set locale='en' where id=${owner.id}`
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(batchUrl)
    await page.getByRole("button", { name: "Decision: Synthetic hold", exact: true }).hover()
    await expect(page.locator('[data-slot="tooltip-content"]').filter({ visible: true })).toContainText("The bank has not posted")
    await page.mouse.move(0, 0)
    await page.getByRole("button", { name: "Import 1 transaction", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Record transactions", exact: true }).click()
    await expect(page.getByRole("link", { name: "Open transactions", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Undo import", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Undo import", exact: true }).click()
    await expect(page.getByText("Import undone", { exact: true }).first()).toBeVisible()

    await page.goto("/accounts")
    await page.getByRole("button", { name: "Account", exact: true }).click()
    await page.getByLabel("Name", { exact: true }).fill("Travel card")
    const opening = page.getByLabel("Opening balance", { exact: true })
    await opening.fill("1234.56")
    await expect(opening.locator("..")).toContainText("₽")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expect(page.getByRole("listitem").filter({ hasText: "Travel card" })).toContainText("₽1,234.56")

    await page.goto(`/goals/${goal.id}`)
    await page.getByRole("button", { name: "Add money", exact: true }).click()
    await page.getByLabel("Amount sent", { exact: true }).fill("100")
    await page.getByRole("button", { name: "Record", exact: true }).click()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    const [transfer] =
      await db`select title from transactions where household_id=${owner.household_id} and title='Towards goal: Семейный отпуск'`
    expect(transfer?.title).toBe("Towards goal: Семейный отпуск")

    await noOverflow(page)
  })
})
