import { randomBytes, createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { expect, test } from "./fixtures"
import { SETUP_TOKEN, E2E_ENV } from "../playwright.config"
import postgres from "postgres"

test("AI consent, streaming proposal, selective apply and ru/en mobile layouts", async ({ browser }) => {
  const context = await browser.newContext({ locale: "ru-RU", viewport: { width: 1280, height: 950 }, colorScheme: "light" })
  const page = await context.newPage()
  const db = postgres(E2E_ENV.DATABASE_URL, { max: 1 })
  const screenshots = "docs/screenshots/ai"
  await mkdir(screenshots, { recursive: true })
  try {
    await page.goto("/")
    await expect(page).toHaveURL(/\/(setup|login)/)
    if (page.url().includes("setup")) {
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
    if (!household) throw new Error("Missing synthetic household")
    const token = randomBytes(24).toString("hex")
    await db`insert into invitations(household_id, token_hash, role, expires_at) values (${household.id}, ${createHash("sha256").update(token).digest("hex")}, 'member', now() + interval '1 day')`
    await page.goto(`/invite/${token}`)
    await page.getByLabel("Имя", { exact: true }).fill("AI Demo")
    await page.getByLabel("E-mail").fill("ai-demo@e2e.test")
    await page.getByLabel("Пароль", { exact: true }).fill("ai-password-123")
    await page.getByLabel("Повторите пароль").fill("ai-password-123")
    await page.getByRole("button", { name: "Создать аккаунт и присоединиться", exact: true }).click()
    await expect(page).toHaveURL(/dashboard/)
    await page.goto("/onboarding?new=1")
    await page.getByLabel("Название", { exact: true }).fill("AI synthetic family")
    await page.getByRole("button", { name: "Создать", exact: true }).click()
    await expect(page).toHaveURL(/dashboard/)
    await db`delete from household_members where user_id = (select id from users where email = 'ai-demo@e2e.test') and role = 'member'`
    await db`update users set role = 'admin' where email = 'ai-demo@e2e.test'`
    const disabled = await context.request.post("/api/ai/chat", {
      headers: { Origin: E2E_ENV.APP_URL },
      data: { id: crypto.randomUUID(), message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "test" }] } },
    })
    expect(disabled.status()).toBe(404)
    await page.goto("/admin?tab=ai")
    await page.getByLabel("Провайдер", { exact: true }).selectOption("mock")
    await page.getByLabel("Модель", { exact: true }).fill("test-budget")
    await page.getByRole("checkbox", { name: "Включить на инстансе", exact: true }).check()
    await page.getByRole("button", { name: "Проверить подключение", exact: true }).click()
    await expect(page.getByText("Подключение и вызов инструментов работают", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "Сохранить", exact: true }).click()
    await expect(page.getByText("Настройки сохранены", { exact: true })).toBeVisible()
    await page.screenshot({ path: `${screenshots}/admin-ru.png`, animations: "disabled", fullPage: true })
    await page.goto("/settings")
    await page.getByRole("checkbox", { name: "Включить ассистента для семьи", exact: true }).check()
    await page.getByRole("checkbox", { name: "Я согласен на передачу перечисленных данных этому провайдеру.", exact: true }).check()
    await page.getByRole("button", { name: "Сохранить согласие", exact: true }).click()
    await expect(page.getByText("Настройки семьи сохранены", { exact: true })).toBeVisible()
    await page.goto("/assistant")
    await page.getByRole("button", { name: "Новый диалог", exact: true }).click()
    await expect(page).toHaveURL(/assistant\?id=/)
    await page.getByRole("textbox", { name: "Спросите о бюджете…", exact: true }).fill("Помоги настроить бюджеты")
    await page.getByRole("button", { name: "Отправить", exact: true }).click()
    await expect(page.getByTestId("ai-proposal")).toBeVisible()
    await expect(page.getByRole("status").filter({ hasText: "Изучаю ваш бюджет" })).toHaveCount(0)
    const proposal = page.getByTestId("ai-proposal")
    await expect(proposal.getByRole("checkbox")).toHaveCount(3)
    await page.screenshot({ path: `${screenshots}/chat-desktop-ru.png`, animations: "disabled" })
    await page.setViewportSize({ width: 375, height: 812 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `${screenshots}/chat-mobile-ru.png`, animations: "disabled", fullPage: true })
    await proposal.getByRole("checkbox").nth(2).uncheck()
    await proposal.getByRole("button", { name: "Применить выбранное", exact: true }).click()
    await expect(proposal.getByText("Применено частично", { exact: true })).toBeVisible()
    const [count] =
      await db`select count(*)::int n from category_budgets b join household_members m on m.household_id = b.household_id join users u on u.id = m.user_id where u.email = 'ai-demo@e2e.test' and m.role = 'owner'`
    expect(count?.n).toBe(2)
    const chatUrl = page.url()
    await db`update users set locale = 'en' where email = 'ai-demo@e2e.test'`
    await page.goto(chatUrl)
    await expect(page.getByRole("button", { name: "Apply selected", exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const previous = page.url()
    await page.getByRole("button", { name: "New conversation", exact: true }).click()
    await expect(page).not.toHaveURL(previous)
    await page.getByRole("textbox", { name: "Ask about your budget…", exact: true }).fill("Help me set up budgets")
    await page.getByRole("button", { name: "Send", exact: true }).click()
    await expect(page.getByText("Review the proposed monthly budgets below. Apply only the changes you choose.")).toBeVisible()
    await expect(page.getByTestId("ai-proposal")).toBeVisible()
    await page.screenshot({ path: `${screenshots}/chat-mobile-en.png`, animations: "disabled", fullPage: true })
    await page.emulateMedia({ colorScheme: "dark" })
    await page.reload()
    await page.screenshot({ path: `${screenshots}/chat-mobile-en-dark.png`, animations: "disabled", fullPage: true })
    await page.setViewportSize({ width: 1280, height: 950 })
    await page.screenshot({ path: `${screenshots}/chat-desktop-en.png`, animations: "disabled" })
  } finally {
    await db.end()
    await context.close()
  }
})
