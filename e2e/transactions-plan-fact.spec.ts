import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { test, expect, withDb, type StorageState, type Page } from "./matrix"
import { E2E_ENV, BROWSER_TIMEZONE } from "../playwright.config"
import { addDays, addMonths, todayIn } from "../src/lib/dates"

let state: StorageState
let accountId: string
const today = todayIn("Europe/Moscow")
const planTitles = [
  "Пример: просроченный платёж", "Пример: план на сегодня",
  `Пример: ближайшая подписка ${"Длинноеназвание".repeat(5)}`,
  ...Array.from({ length: 6 }, (_, i) => `Пример: будущий платёж ${i + 1}`),
  "Пример: самый далёкий план",
]
const postedTitles = ["Пример: покупка сегодня", "Пример: покупка вчера", "Пример: покупка раньше"]

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  const outside = await page.locator('[data-slot="app-header"], h1, main ul, main li, main [role="combobox"]').evaluateAll((elements) => elements.filter((element) => {
    const box = element.getBoundingClientRect()
    return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1)
  }).map((element) => `${element.tagName}: ${element.textContent?.slice(0, 60)}`))
  expect(outside, "Header, filters and cards must fit without right-edge clipping").toEqual([])
}

test.use({ serviceWorkers: "block", locale: "ru-RU", colorScheme: "light", reducedMotion: "reduce" })
test.setTimeout(60_000)

test.beforeAll(async ({ browser }) => {
  const email = `plan-fact-${randomUUID()}@e2e.test`
  const password = "synthetic-plan-fact-password"
  execFileSync(process.execPath, ["--import", "tsx", "scripts/admin.ts", "create-admin"], {
    env: { ...process.env, ...E2E_ENV, ADMIN_NAME: "Пример пользователя", ADMIN_EMAIL: email, ADMIN_PASSWORD: password }, stdio: "pipe",
  })
  const context = await browser.newContext({ serviceWorkers: "block", locale: "ru-RU", timezoneId: BROWSER_TIMEZONE })
  try {
    const response = await context.request.post("/api/auth/sign-in/email", { headers: { Origin: E2E_ENV.APP_URL }, data: { email, password } })
    expect(response.ok()).toBe(true)
    const page = await context.newPage()
    await page.goto("/onboarding")
    await page.getByLabel("Название", { exact: true }).fill("Синтетический бюджет")
    await page.getByRole("button", { name: "Создать", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await page.waitForLoadState("networkidle")
    state = await context.storageState()
  } finally { await context.close() }
  await withDb(async (db) => {
    const [owner] = await db`select u.id, hm.household_id from users u join household_members hm on hm.user_id=u.id where u.email=${email}`
    const [account] = await db`select id from financial_accounts where household_id=${owner!.household_id}`
    const [category] = await db`select id from categories where household_id=${owner!.household_id} and name='Продукты'`
    accountId = String(account!.id)
    await db`update financial_accounts set name=${`Синтетический счёт с длинным названием ${"Название".repeat(8)}`} where id=${accountId}`
    const plans = [addDays(today, -1), today, addDays(today, 1), ...Array.from({ length: 6 }, (_, i) => addDays(today, i + 2)), addMonths(today, 4)]
    for (const [i, date] of plans.entries()) {
      await db`insert into transactions (household_id, created_by, account_id, category_id, type, status, amount, title, date)
        values (${owner!.household_id}, ${owner!.id}, ${accountId}, ${category!.id}, 'expense', 'planned', 12345, ${planTitles[i]!}, ${date})`
    }
    for (let i = 0; i < 52; i++) {
      await db`insert into transactions (household_id, created_by, account_id, category_id, type, status, amount, title, date)
        values (${owner!.household_id}, ${owner!.id}, ${accountId}, ${category!.id}, 'expense', 'posted', 23456, ${postedTitles[i] ?? `История ${i}`}, ${addDays(today, -i)})`
    }
    for (const date of [today, addDays(today, -1)]) {
      await db`insert into transactions (household_id, created_by, account_id, category_id, type, status, amount, title, date)
        values (${owner!.household_id}, ${owner!.id}, ${accountId}, ${category!.id}, 'expense', 'skipped', 100, 'Пропущенный пример', ${date})`
    }
  })
})
test.beforeEach(async ({ context }) => { await context.addCookies(state.cookies) })

for (const width of [1280, 375]) {
  test(`plans precede posted history, ru light ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await page.addInitScript(() => localStorage.setItem("theme", "light"))
    const params = new URLSearchParams({ q: "Пример:", accountId, type: "expense", from: addDays(today, -60), to: addMonths(today, 5) })
    await page.goto(`/transactions?${params}`)
    await expect(page).toHaveTitle("Операции · BestBudget")
    await expect(page.locator("html")).toHaveClass(/light/)
    const planned = page.getByRole("region", { name: "Запланировано", exact: true })
    const posted = page.getByRole("region", { name: "Проведено", exact: true })
    await expect(planned.getByRole("listitem")).toHaveCount(8)
    await expect(planned.getByRole("listitem").locator("button.text-left")).toHaveText(planTitles.slice(0, 8).map((title) => new RegExp(title)))
    await expect(planned.getByRole("listitem").first()).toContainText("просрочено")
    await expect(page.getByText(planTitles[9]!, { exact: true })).toHaveCount(0)
    await expect(posted.getByRole("listitem").locator("button.text-left")).toHaveText(postedTitles.map((title) => new RegExp(title)))
    expect(await planned.evaluate((element) => Boolean(element.compareDocumentPosition(document.getElementById("transactions-heading")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true)
    await expect(planned.getByText(/^Сегодня ·/)).toHaveCount(1)
    await expect(posted.getByText(/^Сегодня ·/)).toHaveCount(1)
    await expect(planned.locator("section > div > .tabular")).toHaveCount(0)
    await expect(posted.locator("section > div > .tabular")).toHaveCount(3)
    await fits(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    for (const fullPage of [false, true]) {
      const path = info.outputPath(`transactions-ru-light-${width}${fullPage ? "-full" : ""}.png`)
      await page.screenshot({ path, fullPage, animations: "disabled" })
      await info.attach(`ru-light-${width}${fullPage ? "-full" : ""}`, { path, contentType: "image/png" })
    }
    // Both the row editor and its menu survive the split.
    await planned.getByRole("listitem").nth(2).locator("button.text-left").click()
    await expect(page.getByRole("dialog").getByLabel("Название", { exact: true })).toHaveValue(planTitles[2]!)
    await page.getByRole("dialog").getByRole("button", { name: "Отмена", exact: true }).click()
    await planned.getByRole("listitem").nth(2).getByRole("button", { name: "Действия", exact: true }).click()
    await expect(page.getByRole("menuitem", { name: "Изменить", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    const showAll = planned.getByRole("link", { name: "Показать все (10)", exact: true })
    const expected = new URLSearchParams(params)
    expected.set("status", "planned")
    await expect(showAll).toHaveAttribute("href", `/transactions?${expected}`)
    await showAll.click()
    await expect(page).toHaveURL(new RegExp("status=planned"))
    await expect(planned.getByRole("listitem")).toHaveCount(10)
    await expect(planned.getByRole("listitem").locator("button.text-left")).toHaveText(planTitles.map((title) => new RegExp(title)))
    await expect(planned.getByRole("listitem").last()).toContainText(planTitles[9]!)
    await expect(posted).toHaveCount(0)
    await fits(page)

    await page.goto("/transactions")
    await expect(posted.getByRole("listitem")).toHaveCount(50)
    await posted.getByRole("link", { name: "Дальше", exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(planned).toHaveCount(0)
    await expect(posted.getByRole("listitem")).toHaveCount(2)
    await page.goto("/transactions?status=posted")
    await expect(planned).toHaveCount(0)
    await expect(posted.getByRole("listitem")).toHaveCount(50)
    await page.goto("/transactions?status=skipped")
    const skipped = page.getByRole("region", { name: "Пропущено", exact: true })
    await expect(skipped.getByRole("listitem")).toHaveCount(2)
    await expect(skipped.locator("section").first()).toContainText("Сегодня")
    await page.goto(`/transactions?${new URLSearchParams({ q: "покупка" })}`)
    await expect(planned).toHaveCount(0)
    await expect(posted.getByRole("listitem")).toHaveCount(3)
    await page.goto(`/transactions?${new URLSearchParams({ q: "план на сегодня" })}`)
    await expect(posted).toHaveCount(0)
    await expect(planned.getByRole("listitem")).toHaveCount(1)
    await expect(planned.getByRole("link")).toHaveCount(0)
    await page.goto("/transactions?q=no-synthetic-match")
    await expect(page.getByText("Ничего не найдено", { exact: true }).filter({ visible: true })).toHaveCount(1)
    await expect(planned).toHaveCount(0)
    await expect(posted).toHaveCount(0)
  })
}
