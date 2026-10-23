import { createHash, randomBytes } from "node:crypto"
import { mkdir } from "node:fs/promises"
import postgres from "postgres"
import { E2E_ENV, SETUP_TOKEN } from "../playwright.config"
import { expect, test } from "./fixtures"

test("budget reviews: opt-in schedule, recommendations, apply/dismiss, repeat suppression and discussion", async ({ browser }) => {
  test.setTimeout(180_000)
  const context = await browser.newContext({
    serviceWorkers: "block",
    locale: "ru-RU",
    viewport: { width: 1280, height: 950 },
    reducedMotion: "reduce",
  })
  const page = await context.newPage()
  const db = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => {} })
  const screenshotDir = "docs/screenshots/ai/budget-review"
  const email = `ai-review-${randomBytes(4).toString("hex")}@e2e.test`
  try {
    await page.goto("/login")
    if (page.url().includes("/setup")) {
      await page.getByLabel("Токен настройки").fill(SETUP_TOKEN)
      await page.getByLabel("Имя", { exact: true }).fill("Setup Demo")
      await page.getByLabel("E-mail").fill("owner@e2e.test")
      await page.getByLabel("Пароль", { exact: true }).fill("owner-password-1")
      await page.getByLabel("Повторите пароль").fill("owner-password-1")
      await page.getByRole("button", { name: "Создать администратора", exact: true }).click()
      await expect(page).toHaveURL(/onboarding/)
      await page.getByRole("button", { name: "Создать", exact: true }).click()
      await expect(page).toHaveURL(/dashboard/)
    }
    await context.clearCookies()
    const [household] = await db`select id from households order by created_at limit 1`
    if (!household) throw new Error("Synthetic household missing")
    const token = randomBytes(24).toString("hex")
    await db`insert into invitations(household_id, token_hash, role, expires_at) values (${household.id}, ${createHash("sha256").update(token).digest("hex")}, 'member', now() + interval '1 day')`
    await page.goto(`/invite/${token}`)
    await page.getByLabel("Имя", { exact: true }).fill("Review Demo")
    await page.getByLabel("E-mail").fill(email)
    await page.getByLabel("Пароль", { exact: true }).fill("review-password-1")
    await page.getByLabel("Повторите пароль").fill("review-password-1")
    await page.getByRole("button", { name: "Создать аккаунт и присоединиться", exact: true }).click()
    await expect(page).toHaveURL(/dashboard/)
    await page.goto("/onboarding?new=1")
    await page.getByLabel("Название", { exact: true }).fill("Разбор бюджета · демо")
    await page.getByRole("button", { name: "Создать", exact: true }).click()
    await expect(page).toHaveURL(/dashboard/)
    await db`delete from household_members where user_id = (select id from users where email = ${email}) and role = 'member'`
    await db`update users set role = 'admin' where email = ${email}`
    const [owner] =
      await db`select u.id, m.household_id from users u join household_members m on m.user_id = u.id where u.email = ${email} and m.role = 'owner'`
    if (!owner) throw new Error("Synthetic review owner missing")
    await page.goto("/admin?tab=ai")
    await page.getByLabel("Провайдер", { exact: true }).selectOption("mock")
    await page.getByLabel("Модель", { exact: true }).fill("test-budget")
    await page.getByRole("checkbox", { name: "Включить на инстансе", exact: true }).check()
    await page.getByRole("button", { name: "Сохранить", exact: true }).click()
    await expect(page.getByText("Настройки сохранены", { exact: true })).toBeVisible()
    await page.goto("/settings")
    await expect(page.getByText("Сначала подтвердите согласие", { exact: false }).filter({ visible: true })).toBeVisible()
    await page.getByRole("checkbox", { name: "Включить ассистента для семьи", exact: true }).check()
    await page.getByRole("checkbox", { name: "Я согласен на передачу перечисленных данных этому провайдеру.", exact: true }).check()
    await page.getByRole("button", { name: "Сохранить согласие", exact: true }).click()
    await expect(page.getByRole("radio", { name: "Выкл", exact: true })).toHaveAttribute("aria-checked", "true")
    await page.getByRole("radio", { name: "Раз в неделю", exact: true }).click()
    await page.getByRole("combobox", { name: "День недели", exact: true }).click()
    await page.getByRole("option", { name: "Пятница", exact: true }).click()
    await page.getByLabel("Время разбора", { exact: true }).fill("10:00")
    await page.getByRole("button", { name: "Сохранить расписание", exact: true }).click()
    await expect(page.getByText("Расписание сохранено", { exact: true })).toBeVisible()
    await page.goto("/assistant")
    await page.getByRole("link", { name: "Рекомендации", exact: true }).filter({ visible: true }).click()
    await expect(page).toHaveURL(/assistant\/recommendations/)
    await page.getByRole("button", { name: "Разобрать сейчас", exact: true }).click()
    const cards = page.getByTestId("ai-recommendation")
    await expect(cards).toHaveCount(2)
    await expect(cards.locator('[data-slot="card"]')).toHaveCount(0)
    await expect(cards.getByRole("checkbox")).toHaveCount(2)
    await expect(page.getByTestId("ai-review-badge")).toHaveText("2")
    const [before] = await db`select count(*)::int n from category_budgets where household_id = ${owner.household_id}`
    expect(before!.n).toBe(0)
    if (process.env.UPDATE_SCREENSHOTS === "1") await mkdir(screenshotDir, { recursive: true })
    {
      for (const locale of ["ru", "en"]) {
        await db`update users set locale = ${locale} where id = ${owner.id}`
        for (const width of [1280, 375]) {
          await page.setViewportSize({ width, height: width === 375 ? 812 : 950 })
          for (const theme of ["light", "dark"]) {
            await page.evaluate((value) => localStorage.setItem("theme", value), theme)
            await page.goto("/assistant/recommendations")
            await expect(page.locator("html")).toHaveAttribute("lang", locale)
            await expect(page.locator("html")).toHaveClass(new RegExp(theme))
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            if (process.env.UPDATE_SCREENSHOTS === "1")
              await page.screenshot({
                path: `${screenshotDir}/recommendations-${locale}-${width}-${theme}.png`,
                fullPage: true,
                animations: "disabled",
              })
            await page.goto("/dashboard")
            await expect(page.getByTestId("ai-review-widget")).toContainText(
              locale === "ru" ? "Рекомендации по бюджету: 2" : "Budget recommendations: 2",
            )
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            if (process.env.UPDATE_SCREENSHOTS === "1")
              await page.screenshot({
                path: `${screenshotDir}/dashboard-${locale}-${width}-${theme}.png`,
                fullPage: true,
                animations: "disabled",
              })
            if (process.env.UPDATE_SCREENSHOTS === "1") {
              await page.goto("/settings?tab=household#ai-review-settings")
              await expect(page.getByRole("radio", { name: locale === "ru" ? "Раз в неделю" : "Weekly", exact: true })).toHaveAttribute(
                "aria-checked",
                "true",
              )
              await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
              await page.screenshot({
                path: `${screenshotDir}/settings-${locale}-${width}-${theme}.png`,
                fullPage: true,
                animations: "disabled",
              })
            }
          }
        }
      }
    }
    await db`update users set locale = 'ru' where id = ${owner.id}`
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/dashboard")
    await expect(page.getByTestId("ai-review-widget")).toContainText("Рекомендации по бюджету: 2")
    await page.getByTestId("ai-review-widget").getByRole("link", { name: "Открыть рекомендации", exact: true }).click()
    await expect(page).toHaveURL(/assistant\/recommendations/)
    await expect(cards).toHaveCount(2)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await db`insert into transactions(household_id, type, status, amount, title, date, account_id, category_id, created_by)
      select ${owner.household_id}, 'expense', 'posted', 25000, 'Coffee after review', current_date, a.id, c.id, ${owner.id}
      from financial_accounts a cross join categories c
      where a.household_id = ${owner.household_id} and c.household_id = ${owner.household_id} and c.kind = 'expense' limit 1`
    await page.reload()
    await expect(page.locator('[data-testid="ai-recommendation"][data-status="pending"]')).toHaveCount(2)
    await expect(page.getByTestId("ai-stale-item")).toHaveCount(0)
    await expect(page.getByTestId("ai-review-changed")).toBeVisible()
    const [changedCategory] = await db`
      with target as (
        select id from ai_recommendations where household_id = ${owner.household_id}
        order by created_at desc offset 1 limit 1
      )
      select c.id, c.name from target r
      join ai_recommendation_proposals l on l.recommendation_id = r.id and l.household_id = ${owner.household_id}
      join ai_proposals p on p.id = l.proposal_id and p.household_id = l.household_id
      cross join lateral jsonb_array_elements(p.items) item
      join categories c on c.id = (item->'after'->>'categoryId')::uuid and c.household_id = p.household_id
      where item->>'type' = 'budget.set'`
    expect(changedCategory).toBeDefined()
    expect(await cards.nth(1).getByRole("checkbox").getAttribute("aria-label")).toContain(changedCategory!.name)
    const changedBudgets = await db`insert into category_budgets(household_id, category_id, amount, updated_by)
      values (${owner.household_id}, ${changedCategory!.id}, 900, ${owner.id}) returning id`
    expect(changedBudgets).toHaveLength(1)
    await page.reload()
    await expect(cards.first().getByRole("checkbox")).toBeEnabled()
    await expect(cards.nth(1).getByRole("checkbox")).toBeDisabled()
    await expect(page.getByTestId("ai-stale-item")).toContainText(changedCategory!.name)
    await expect(cards.nth(1).getByRole("button", { name: "Применить выбранное", exact: true })).toBeDisabled()
    const firstId = await cards.first().getAttribute("data-status")
    expect(firstId).toBe("pending")
    await cards.first().getByRole("button", { name: "Применить выбранное", exact: true }).click()
    await expect(page.locator('[data-testid="ai-recommendation"][data-status="pending"]')).toHaveCount(1)
    await expect(page.getByTestId("ai-review-changed")).toBeVisible()
    await page.locator("summary").click()
    await expect(page.locator('[data-testid="ai-recommendation"][data-status="applied"]')).toHaveCount(1)
    const remaining = page.locator('[data-testid="ai-recommendation"][data-status="pending"]')
    await expect(remaining).toHaveCount(1)
    await remaining.getByRole("button", { name: "Отклонить", exact: true }).click()
    await expect(page.locator('[data-testid="ai-recommendation"][data-status="dismissed"]')).toHaveCount(1)
    const [after] = await db`select count(*)::int n from category_budgets where household_id = ${owner.household_id}`
    expect(after!.n).toBe(2)
    const [applied] = await db`select count(*)::int n from ai_proposals where household_id = ${owner.household_id} and status = 'applied'`
    expect(applied!.n).toBe(1)
    const [decision] = await db`select count(*)::int n from ai_review_decisions where household_id = ${owner.household_id}`
    expect(decision!.n).toBe(1)
    await page.getByRole("button", { name: "Разобрать сейчас", exact: true }).click()
    await expect
      .poll(async () => {
        const [row] = await db`select count(*)::int n from ai_reviews where household_id = ${owner.household_id} and status = 'completed'`
        return row!.n
      })
      .toBe(2)
    await expect(page.getByText("Нет новых рекомендаций", { exact: true })).toBeVisible()
    await expect(page.locator('[data-testid="ai-recommendation"][data-status="pending"]')).toHaveCount(0)
    await expect(page.getByTestId("ai-review-badge")).toHaveCount(0)
    await page.goto("/dashboard")
    await expect(page.getByTestId("ai-review-widget")).toContainText("Рекомендации по бюджету: 0")
    await page.goto("/assistant/recommendations")
    await page.locator("summary").click()
    await page
      .locator('[data-testid="ai-recommendation"][data-status="dismissed"]')
      .getByRole("button", { name: "Обсудить", exact: true })
      .click()
    await expect(page).toHaveURL(/assistant\?id=/)
    await expect(page.getByTestId("ai-messages")).toContainText("Для планирования категории")
    const [settings] = await db`select frequency, weekday, time from ai_review_settings where household_id = ${owner.household_id}`
    expect(settings).toMatchObject({ frequency: "weekly", weekday: 5, time: "10:00" })
  } finally {
    await db.end()
    await context.close()
  }
})
