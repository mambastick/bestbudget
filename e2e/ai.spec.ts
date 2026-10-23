import { screenshot } from "./matrix"
import { watchAiFeed, expectSingleAiFeed, expectAiFeedHydration } from "./ai-feed"
import { randomBytes, createHash } from "node:crypto"
import { expect, test } from "./fixtures"
import { SETUP_TOKEN, E2E_ENV } from "../playwright.config"
import { createE2eDb } from "./db"

for (const locale of ["ru", "en"] as const)
  for (const width of [1280, 375]) {
    test(`AI consent, selective apply and streaming recovery (${locale}, ${width})`, async ({ browser }) => {
      test.setTimeout(60_000)
      const context = await browser.newContext({
        serviceWorkers: "block",
        locale: "ru-RU",
        viewport: { width: 1280, height: 950 },
        colorScheme: "light",
      })
      const email = `ai-demo-${randomBytes(8).toString("hex")}@e2e.test`
      const page = await context.newPage()
      // Next.js may retain previous routes in hidden Activity trees.
      const chat = page.getByTestId("ai-chat").filter({ visible: true })
      await watchAiFeed(page)
      page.setDefaultTimeout(15000)
      const db = createE2eDb()
      const screenshots = "docs/screenshots/ai"
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
        await page.getByLabel("E-mail").fill(email)
        await page.getByLabel("Пароль", { exact: true }).fill("ai-password-123")
        await page.getByLabel("Повторите пароль").fill("ai-password-123")
        await page.getByRole("button", { name: "Создать аккаунт и присоединиться", exact: true }).click()
        await expect(page).toHaveURL(/dashboard/)
        await page.goto("/onboarding?new=1")
        await page.getByLabel("Название", { exact: true }).fill("AI synthetic family")
        await page.getByRole("button", { name: "Создать", exact: true }).click()
        await expect(page).toHaveURL(/dashboard/)
        await db`delete from household_members where user_id = (select id from users where email = ${email}) and role = 'member'`
        await db`update users set role = 'admin' where email = ${email}`
        const disabled = await context.request.post("/api/ai/chat", {
          headers: { Origin: E2E_ENV.APP_URL },
          data: { id: crypto.randomUUID(), message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "test" }] } },
        })
        expect(disabled.status()).toBe(404)
        await page.goto("/admin?tab=ai")
        await page.getByLabel("Провайдер", { exact: true }).selectOption("mock")
        await page.getByRole("button", { name: "Получить модели", exact: true }).click()
        await expect(page.locator("#ai-models option[value=test-budget]")).toHaveCount(1)
        await page.getByLabel("Модель", { exact: true }).fill("test-budget")
        await page.getByRole("checkbox", { name: "Включить на инстансе", exact: true }).check()
        await page.getByRole("button", { name: "Проверить подключение", exact: true }).click()
        await expect(page.getByText("Подключение и вызов инструментов работают", { exact: true })).toBeVisible()
        await page.getByRole("button", { name: "Сохранить", exact: true }).click()
        await expect(page.getByText("Настройки сохранены", { exact: true })).toBeVisible()
        await screenshot(page, `${screenshots}/admin-ru.png`, true)
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
        await expect(chat.getByTestId("ai-proposal")).toBeVisible()
        await expect(page.getByRole("status").filter({ hasText: "Изучаю ваш бюджет" })).toHaveCount(0)
        const proposal = chat.getByTestId("ai-proposal")
        await expect(proposal.getByRole("checkbox")).toHaveCount(3)
        await expect(proposal).not.toContainText("→")
        await expect(proposal.getByText(/Новый лимит/)).toHaveCount(3)
        await screenshot(page, `${screenshots}/chat-desktop-ru.png`)
        await page.emulateMedia({ colorScheme: "dark" })
        await page.reload()
        await screenshot(page, `${screenshots}/chat-desktop-ru-dark.png`)
        await page.emulateMedia({ colorScheme: "light" })
        await page.reload()
        await page.setViewportSize({ width: 375, height: 812 })
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const feed = chat.getByTestId("ai-messages")
        const composer = chat.getByTestId("ai-composer")
        await feed.evaluate((el) => {
          el.scrollTop = 0
        })
        await expect.poll(() => composer.evaluate((el) => Math.abs(el.getBoundingClientRect().bottom - innerHeight) < 2)).toBe(true)
        await expect.poll(() => feed.evaluate((el) => el.scrollTop)).toBe(0)
        await screenshot(page, `${screenshots}/chat-mobile-ru.png`)
        await page.emulateMedia({ colorScheme: "dark" })
        await page.reload()
        await feed.evaluate((el) => {
          el.scrollTop = 0
        })
        await screenshot(page, `${screenshots}/chat-mobile-ru-dark.png`)
        await page.emulateMedia({ colorScheme: "light" })
        await page.reload()
        await page.getByRole("button", { name: "Диалоги", exact: true }).click()
        await expect(page.getByRole("dialog").getByRole("link", { name: "Помоги настроить бюджеты", exact: true })).toBeVisible()
        await screenshot(page, `${screenshots}/dialogs-mobile-ru.png`)
        await page.getByRole("button", { name: "Закрыть", exact: true }).click()
        // Emulate the visual viewport shrinking when a virtual keyboard opens.
        await page.evaluate(() => {
          Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 480 })
          window.visualViewport!.dispatchEvent(new Event("resize"))
        })
        await expect.poll(() => composer.evaluate((el) => Math.round(el.getBoundingClientRect().bottom))).toBe(480)
        await page.evaluate(() => {
          delete (window.visualViewport as unknown as Record<string, unknown>).height
          window.visualViewport!.dispatchEvent(new Event("resize"))
        })
        await proposal.getByRole("checkbox").nth(2).uncheck()
        await proposal.getByRole("button", { name: "Применить выбранное", exact: true }).click()
        await expect(proposal.getByText("Применено частично", { exact: true })).toBeVisible()
        const [count] =
          await db`select count(*)::int n from category_budgets b join household_members m on m.household_id = b.household_id join users u on u.id = m.user_id where u.email = ${email} and m.role = 'owner'`
        expect(count?.n).toBe(2)
        const chatUrl = page.url()
        await expectAiFeedHydration(context, chatUrl)
        await db`update users set locale = 'en' where email = ${email}`
        await page.goto(chatUrl)
        await expect(page.getByRole("button", { name: "Apply selected", exact: true })).toBeVisible()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const previous = page.url()
        await page.getByRole("button", { name: "Conversations", exact: true }).click()
        await page.getByRole("button", { name: "New conversation", exact: true }).click()
        await expect(page).not.toHaveURL(previous)
        await page.getByRole("textbox", { name: "Ask about your budget…", exact: true }).fill("Help me set up budgets")
        await page.getByRole("button", { name: "Send", exact: true }).click()
        await expect(page.getByText("Review the proposed monthly budgets below. Apply only the changes you choose.")).toBeVisible()
        await expect(chat.getByTestId("ai-proposal")).toBeVisible()
        await expect(proposal.getByRole("checkbox")).toHaveCount(1)
        await expect(proposal).not.toContainText("→")
        await expectSingleAiFeed(page)
        await page.getByTestId("ai-messages").evaluate((el) => {
          el.scrollTop = 0
        })
        await screenshot(page, `${screenshots}/chat-mobile-en.png`)
        await page.emulateMedia({ colorScheme: "dark" })
        await page.reload()
        await expectSingleAiFeed(page)
        await page.getByTestId("ai-messages").evaluate((el) => {
          el.scrollTop = 0
        })
        await screenshot(page, `${screenshots}/chat-mobile-en-dark.png`)
        await page.setViewportSize({ width: 1280, height: 950 })
        await screenshot(page, `${screenshots}/chat-desktop-en.png`)
        await page.emulateMedia({ colorScheme: "light" })
        await page.reload()
        await screenshot(page, `${screenshots}/chat-desktop-en-light.png`)
        // Menu belongs to each list row; deleting a different conversation keeps the active one open.
        await page.getByRole("button", { name: "Conversation actions: Помоги настроить бюджеты", exact: true }).click()
        await page.getByRole("menuitem", { name: "Delete conversation", exact: true }).click()
        await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click()
        await expect(page.getByRole("link", { name: "Помоги настроить бюджеты", exact: true })).toHaveCount(0)

        await db`update users set locale = ${locale} where email = ${email}`
        const mobile = width === 375
        await page.setViewportSize({ width, height: mobile ? 812 : 950 })
        await page.emulateMedia({ colorScheme: mobile ? "dark" : "light" })
        await page.goto("/assistant")
        if (mobile) await page.getByRole("button", { name: locale === "ru" ? "Диалоги" : "Conversations", exact: true }).click()
        await page.getByRole("button", { name: locale === "ru" ? "Новый диалог" : "New conversation", exact: true }).click()
        await expect(page).toHaveURL(/assistant\?id=/)
        await expect(chat).toHaveAttribute("data-conversation-id", new URL(page.url()).searchParams.get("id")!)
        const field = page.getByRole("textbox", { name: locale === "ru" ? "Спросите о бюджете…" : "Ask about your budget…", exact: true })
        await field.fill(locale === "ru" ? "Помоги настроить бюджеты, пожалуйста" : "Help me set up budgets, please")
        await page.getByRole("button", { name: locale === "ru" ? "Отправить" : "Send", exact: true }).click()
        await expect(chat.getByTestId("ai-status")).toContainText(locale === "ru" ? "Изучаю ваш бюджет" : "Exploring your budget")
        await screenshot(page, `${screenshots}/thinking-${locale}-${width}.png`)
        await expect(chat.getByTestId("ai-status")).toContainText(locale === "ru" ? "Изучаю категории" : "Reviewing categories")
        await screenshot(page, `${screenshots}/tools-${locale}-${width}.png`)
        // User scrolling up must not be overridden by later streamed chunks.
        const messages = chat.getByTestId("ai-messages")
        await messages.evaluate((el) => {
          const spacer = document.createElement("div")
          spacer.style.height = "1200px"
          el.prepend(spacer)
          el.scrollTop = 0
          el.dispatchEvent(new Event("scroll"))
        })
        await page.waitForTimeout(700)
        expect(await messages.evaluate((el) => el.scrollTop)).toBe(0)
        await expect(chat.getByTestId("ai-status")).toHaveCount(0, { timeout: 20000 })
        await field.fill(locale === "ru" ? "Попробуй ещё раз" : "Try again")
        await page.getByRole("button", { name: locale === "ru" ? "Отправить" : "Send", exact: true }).click()
        await expect(chat.getByTestId("ai-error")).toBeVisible()
        await expect(
          chat.getByTestId("ai-error").getByRole("button", { name: locale === "ru" ? "Повторить" : "Retry", exact: true }),
        ).toBeVisible()
        await expect
          .poll(() =>
            chat.getByTestId("ai-error").evaluate((el) => {
              const r = el.getBoundingClientRect()
              return r.top >= 0 && r.bottom <= innerHeight
            }),
          )
          .toBe(true)
        const errorBottom = await chat
          .getByTestId("ai-error")
          .getByRole("paragraph")
          .evaluate((el) => el.getBoundingClientRect().bottom)
        const composerTop = await chat.getByTestId("ai-composer").evaluate((el) => el.getBoundingClientRect().top)
        expect(errorBottom).toBeLessThanOrEqual(composerTop)
        await screenshot(page, `${screenshots}/error-${locale}-${width}.png`)
      } finally {
        await db.end()
        await context.close()
      }
    })
  }
