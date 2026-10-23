import { test, expect, seedDemo, withDb, screenshot, type StorageState, type Page } from "./matrix"
import { BROWSER_TIMEZONE } from "../playwright.config"

let state: StorageState
let userId: string
const screenshotDir = "docs/screenshots/i18n/finance"
const routes = [
  ["/dashboard", "Обзор", "Overview"],
  ["/calendar", "Календарь", "Calendar"],
  ["/budgets", "Бюджеты", "Budgets"],
  ["/analytics", "Аналитика", "Analytics"],
  ["/transactions", "Операции", "Transactions"],
  ["/transactions?tab=rules", "Операции", "Transactions"],
] as const

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  const clipped = await page.evaluate(() => [...document.querySelectorAll("main *")].filter((element) => {
    const box = element.getBoundingClientRect()
    return box.width > 0 && (box.right > innerWidth + 1 || box.left < -1)
      && !element.closest('.overflow-x-auto, .overflow-hidden, [data-slot="chart"]')
  }).map((element) => `${element.tagName}: ${element.textContent?.slice(0, 80)}`))
  expect(clipped).toEqual([])
}

async function chooseCategory(page: Page) {
  await page.getByRole("dialog").getByRole("combobox").filter({ hasText: "Choose a category" }).click()
  await page.getByRole("option", { name: "Продукты", exact: true }).click()
}


test.use({ serviceWorkers: "block", colorScheme: "light", reducedMotion: "reduce" })
test.setTimeout(60_000)

test.beforeAll(async ({ browser }) => {
  const seeded = await seedDemo(browser, "finance-i18n", "Синтетическая семья")
  state = seeded.state
  userId = seeded.id
})
test.beforeEach(async ({ context }) => { await context.addCookies(state.cookies) })

for (const locale of ["ru", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1280, 375]) {
      test(`finance: ${locale}, ${theme}, ${width}px`, async ({ page }, testInfo) => {
        await withDb(async (db) => { await db`update users set locale=${locale} where id=${userId}` })
        await page.setViewportSize({ width, height: width === 375 ? 900 : 960 })
        await page.addInitScript((value) => localStorage.setItem("theme", value), theme)
        for (const [route, ru, en] of routes) {
          await page.goto(route)
          await expect(page.getByRole("heading", { name: locale === "ru" ? ru : en, exact: true })).toBeVisible()
          await expect(page).toHaveTitle(`${locale === "ru" ? ru : en} · BestBudget`)
          await expect(page.locator("html")).toHaveClass(new RegExp(theme))
          await fits(page)
          if (route === "/analytics") {
            const period = page.getByRole("radiogroup", { name: locale === "ru" ? "Период аналитики" : "Analytics period", exact: true })
            await expect.poll(() => period.evaluate((element) => element.parentElement!.scrollWidth - element.parentElement!.clientWidth)).toBeLessThanOrEqual(0)
            if (width === 375) await expect(page.getByRole("columnheader")).toHaveCount(0)
          }
          if (width === 1280 && (route === "/dashboard" || route === "/analytics")) {
            const chart = page.locator('[data-slot="chart"]').first()
            await chart.hover({ position: { x: 150, y: 80 } })
            const tooltip = chart.locator(".recharts-tooltip-wrapper")
            await expect(tooltip).toBeVisible()
            await expect(tooltip).toContainText("₽")
            await expect(tooltip).not.toContainText("RUB")
            await page.mouse.move(0, 0)
          }
          if (route === "/calendar") {
            // Every displayed short amount includes its currency, including forecast balances.
            await expect(page.locator('button[title]').filter({ hasText: locale === "ru" ? /тыс\./ : /K/ }).first()).toContainText("₽")
            if (locale === "en") {
              await expect(page.getByRole("main").last().locator(".tabular").filter({ hasText: /RUB/ })).toHaveCount(0)
              await expect(page.locator('span[title="Forecast closing balance"]').first()).toContainText(/₽/)
            }
            await expect(page.getByText(locale === "ru" ? "пн" : "Mon", { exact: true }).first()).toBeVisible()
            await page.getByRole("radio", { name: locale === "ru" ? "Список" : "List", exact: true }).click()
            await fits(page)
          }
          if (route === "/transactions?tab=rules") {
            await expect(page.getByText(locale === "ru" ? /Ежемесячно, 5-го числа/ : /Monthly on day 5/).first()).toBeVisible()
          }
          if (locale === "en" && width === 1280 && theme === "light" && route === "/dashboard") {
            const balance = page.getByTestId("actual-balance").locator("span[aria-label]").first()
            await expect(balance).toHaveAttribute("aria-label", /₽/)
            await expect(balance).toHaveText((await balance.getAttribute("aria-label"))!)
            await screenshot(page, `${screenshotDir}/dashboard-en-desktop-light.png`, true)
          }
          if (locale === "en" && width === 1280 && theme === "dark" && route === "/calendar") {
            await page.getByRole("radio", { name: "Month", exact: true }).click()
            await screenshot(page, `${screenshotDir}/calendar-en-desktop-dark.png`)
          }
        }
        // Shared operation entry point: inspect the full recurring form in every locale/theme/width.
        await page.getByRole("button", { name: width === 375 ? locale === "ru" ? "Добавить операцию" : "Add transaction" : locale === "ru" ? "Операция" : "Transaction", exact: true }).first().click()
        const dialog = page.getByRole("dialog")
        await dialog.getByText(locale === "ru" ? "Повторять регулярно" : "Repeat regularly", { exact: true }).click()
        await expect(dialog.getByText(locale === "ru" ? "Периодичность" : "Frequency", { exact: true })).toBeVisible()
        await fits(page)
        if (locale === "en" && width === 375 && theme === "dark") {
          await screenshot(page, `${screenshotDir}/recurring-en-375-dark.png`)
        }
        await dialog.getByRole("button", { name: locale === "ru" ? "Отмена" : "Cancel", exact: true }).click()
        await expect(dialog).toBeHidden()
        await testInfo.attach("finance-layout-matrix", {
          body: JSON.stringify(routes.map(([route]) => ({ locale, theme, width, route }))), contentType: "application/json",
        })
        expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(BROWSER_TIMEZONE)
      })
    }
  }
}

test("finance: English transactions, recurring, budgets and localized CSV", async ({ page, context }) => {
  await withDb(async (db) => { await db`update users set locale='en' where id=${userId}` })
  await page.setViewportSize({ width: 1280, height: 960 })
  await page.goto("/transactions")
  await page.getByRole("button", { name: "Transaction", exact: true }).first().click()
  let dialog = page.getByRole("dialog")
  await dialog.getByLabel("Amount", { exact: true }).fill("12.34")
  await chooseCategory(page)
  await dialog.getByLabel("Title", { exact: true }).fill("Семейный кофе")
  await dialog.getByText("Already posted", { exact: true }).click()
  await dialog.getByRole("button", { name: "Add", exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("Семейный кофе")
  const row = page.getByRole("listitem").filter({ hasText: "Семейный кофе" })
  await expect(row).toContainText("planned")
  await row.getByRole("button", { name: "Actions", exact: true }).click()
  await page.getByRole("menuitem", { name: "Post transaction", exact: true }).click()
  dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Confirm payment", exact: true })).toBeVisible()
  await expect(dialog.getByLabel("Actual amount", { exact: true })).toHaveValue("12.34")
  await dialog.getByLabel("Actual amount", { exact: true }).fill("15.67")
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(row).toContainText("₽15.67")
  await expect(row).not.toContainText("planned")

  await page.getByRole("button", { name: "Transaction", exact: true }).first().click()
  dialog = page.getByRole("dialog")
  await dialog.getByLabel("Amount", { exact: true }).fill("123.45")
  await chooseCategory(page)
  await dialog.getByLabel("Title", { exact: true }).fill("Семейная подписка")
  await dialog.getByText("Repeat regularly", { exact: true }).click()
  await dialog.getByLabel("Day of month", { exact: true }).fill("31")
  await dialog.getByRole("button", { name: "Add", exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.goto("/transactions?tab=rules")
  const rule = page.getByRole("listitem").filter({ hasText: "Семейная подписка" })
  await expect(rule).toContainText("Monthly on day 31")
  await rule.getByRole("button").first().click()
  await expect(page.getByRole("dialog").getByLabel("Amount", { exact: true })).toHaveValue("123.45")
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click()

  await page.goto("/budgets")
  await page.getByRole("button", { name: "Edit limit", exact: true }).first().click()
  await page.getByRole("dialog").getByLabel("Monthly budget limit", { exact: true }).fill("35000.50")
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect(page.getByRole("main").last()).toContainText("35,000.50")

  for (const locale of ["en", "ru"] as const) {
    if (locale === "ru") {
      await page.goto("/settings?tab=profile")
      await page.getByRole("radiogroup", { name: "Language", exact: true }).getByRole("radio", { name: "Русский", exact: true }).click()
      await expect(page.locator("html")).toHaveAttribute("lang", "ru")
    }
    const response = await context.request.get("/api/export/transactions?q=Семейный кофе")
    expect(response.status()).toBe(200)
    expect(response.headers()["cache-control"]).toBe("no-store")
    const csv = (await response.text()).replace(/^\ufeff/, "")
    const [headers, data] = csv.trimEnd().split("\r\n").map((line) => line.split(locale === "ru" ? ";" : ","))
    expect(headers?.slice(0, 4)).toEqual(locale === "ru" ? ["Дата", "Тип", "Статус", "Название"] : ["Date", "Type", "Status", "Title"])
    expect(data?.slice(1, 4)).toEqual(locale === "ru" ? ["Расход", "Выполнена", "Семейный кофе"] : ["Expense", "Posted", "Семейный кофе"])
    expect(data?.[7]).toBe(locale === "ru" ? "-15,67" : "-15.67")
  }
  await fits(page)
})
