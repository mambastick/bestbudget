import { execFileSync } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { expect, test, type Page } from "@playwright/test"
import { E2E_ENV } from "../playwright.config"

const demo = { name: "Finance Demo", email: "finance-i18n@e2e.test", password: "finance-demo-password-1" }
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

test.use({ colorScheme: "light", reducedMotion: "reduce" })

test("finance: ru/en seeded views, responsive themes, English transactions, recurring, budgets and CSV", async ({ page, context }, testInfo) => {
  test.setTimeout(300_000)
  execFileSync(process.execPath, ["--import", "tsx", "scripts/admin.ts", "create-admin"], {
    env: { ...process.env, ...E2E_ENV, ADMIN_NAME: demo.name, ADMIN_EMAIL: demo.email, ADMIN_PASSWORD: demo.password },
  })
  await page.setViewportSize({ width: 1280, height: 960 })
  // The seed uses Russian category names as synthetic user data, retained in both UI languages.
  await context.addCookies([{ name: "bb_locale", value: "ru", url: E2E_ENV.APP_URL }])
  page.setDefaultTimeout(15_000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  await page.goto("/login")
  await page.getByLabel("E-mail").fill(demo.email)
  await page.getByLabel("Пароль", { exact: true }).fill(demo.password)
  await page.getByRole("button", { name: "Войти", exact: true }).click()
  await expect(page).toHaveURL(/\/onboarding/)
  await page.getByLabel("Название").fill("Синтетическая семья")
  await page.getByRole("button", { name: "Создать", exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/seed-demo.ts", demo.email], { env: { ...process.env, ...E2E_ENV } })
  await mkdir(screenshotDir, { recursive: true })
  const audit: { locale: string; theme: string; width: number; route: string }[] = []
  for (const locale of ["ru", "en"] as const) {
    await page.setViewportSize({ width: 1280, height: 960 })
    await page.goto("/settings?tab=profile")
    await page.getByRole("radiogroup", { name: "Язык", exact: true }).getByRole("radio", { name: locale === "ru" ? "Русский" : "English", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("lang", locale)
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => localStorage.setItem("theme", value), theme)
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: width === 375 ? 900 : 960 })
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
          audit.push({ locale, theme, width, route })
          const slug = route.replaceAll(/[/?=]/g, "-")
          await page.screenshot({ path: testInfo.outputPath(`${locale}-${theme}-${width}${slug}.png`), fullPage: true, animations: "disabled" })
          if (route === "/calendar") {
            await expect(page.getByText(locale === "ru" ? "пн" : "Mon", { exact: true }).first()).toBeVisible()
            await page.getByRole("radio", { name: locale === "ru" ? "Список" : "List", exact: true }).click()
            await fits(page)
          }
          if (route === "/transactions?tab=rules") {
            await expect(page.getByText(locale === "ru" ? /Ежемесячно, 5-го числа/ : /Monthly on day 5/).first()).toBeVisible()
          }
          if (locale === "en" && width === 1280 && theme === "light" && route === "/dashboard") {
            const balance = page.getByTestId("actual-balance").locator("span[aria-label]").first()
            await expect(balance).toHaveAttribute("aria-label", /RUB/)
            await expect(balance).toHaveText((await balance.getAttribute("aria-label"))!)
            await page.screenshot({ path: `${screenshotDir}/dashboard-en-desktop-light.png`, fullPage: true, animations: "disabled" })
          }
          if (locale === "en" && width === 1280 && theme === "dark" && route === "/calendar") {
            await page.getByRole("radio", { name: "Month", exact: true }).click()
            await page.screenshot({ path: `${screenshotDir}/calendar-en-desktop-dark.png`, animations: "disabled" })
          }
        }
        // Shared operation entry point: inspect the full recurring form in every locale/theme/width.
        await page.getByRole("button", { name: width === 375 ? locale === "ru" ? "Добавить операцию" : "Add transaction" : locale === "ru" ? "Операция" : "Transaction", exact: true }).first().click()
        const dialog = page.getByRole("dialog")
        await dialog.getByText(locale === "ru" ? "Повторять регулярно" : "Repeat regularly", { exact: true }).click()
        await expect(dialog.getByText(locale === "ru" ? "Периодичность" : "Frequency", { exact: true })).toBeVisible()
        await fits(page)
        if (locale === "en" && width === 375 && theme === "dark") {
          await page.screenshot({ path: `${screenshotDir}/recurring-en-375-dark.png`, animations: "disabled" })
        }
        await dialog.getByRole("button", { name: locale === "ru" ? "Отмена" : "Cancel", exact: true }).click()
        await expect(dialog).toBeHidden()
      }
    }
  }
  const auditPath = testInfo.outputPath("finance-layout-matrix.json")
  await writeFile(auditPath, JSON.stringify(audit, null, 2))
  await testInfo.attach("finance-layout-matrix", { path: auditPath, contentType: "application/json" })
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
  await expect(row).toContainText("RUB 15.67")
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
  expect(errors).toEqual([])
})
