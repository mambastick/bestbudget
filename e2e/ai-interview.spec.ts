import { watchAiFeed, expectSingleAiFeed, expectAiFeedHydration } from "./ai-feed"
import { randomBytes, createHash } from "node:crypto"
import { screenshot } from "./matrix"
import { createE2eDb } from "./db"
import { addMonths, monthKey, todayIn } from "../src/lib/dates"
import { expect, test } from "./fixtures"
import { SETUP_TOKEN } from "../playwright.config"

for (const locale of ["ru", "en"] as const) {
  for (const width of [1280, 375])
    for (const theme of ["light", "dark"] as const) {
      test(`AI budget interview: empty family → questions → atomic plan (${locale}, ${width}, ${theme})`, async ({ browser }) => {
        test.setTimeout(60_000)
        const context = await browser.newContext({ serviceWorkers: "block", locale: "ru-RU", viewport: { width: 1280, height: 950 } })
        const page = await context.newPage(),
          db = createE2eDb()
        await watchAiFeed(page)
        const familyName = `Interview synthetic ${locale} ${randomBytes(8).toString("hex")}`
        const screenshots = "docs/screenshots/ai/interview"
        const consoleErrors: string[] = []
        page.on("console", (message) => {
          if (message.type() === "error") consoleErrors.push(message.text())
        })
        try {
          await page.goto("/")
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
          const [existing] = await db`select id from households order by created_at limit 1`
          const token = randomBytes(24).toString("hex"),
            email = `interview-${locale}-${randomBytes(8).toString("hex")}@e2e.test`
          await db`insert into invitations(household_id, token_hash, role, expires_at) values (${existing!.id}, ${createHash("sha256").update(token).digest("hex")}, 'member', now() + interval '1 day')`
          await page.goto(`/invite/${token}`)
          await page.getByLabel("Имя", { exact: true }).fill("Interview Demo")
          await page.getByLabel("E-mail").fill(email)
          await page.getByLabel("Пароль", { exact: true }).fill("interview-password-123")
          await page.getByLabel("Повторите пароль").fill("interview-password-123")
          await page.getByRole("button", { name: "Создать аккаунт и присоединиться", exact: true }).click()
          await expect(page).toHaveURL(/dashboard/)
          await page.goto("/onboarding?new=1")
          await page.getByLabel("Название", { exact: true }).fill(familyName)
          await page.getByRole("button", { name: "Создать", exact: true }).click()
          await expect(page).toHaveURL(/dashboard/)
          await db`delete from household_members where user_id = (select id from users where email = ${email}) and role = 'member'`
          await db`update users set role = 'admin' where email = ${email}`
          const [family] = await db`select id from households where name = ${familyName}`
          await expect(page.getByTestId("ai-interview-entry")).toHaveCount(0)
          await page.goto("/admin?tab=ai")
          await page.getByLabel("Провайдер", { exact: true }).click()
          await page.getByRole("option", { name: "Mock (test)", exact: true }).click()
          await page.getByLabel("Модель", { exact: true }).fill("test-budget")
          await page.getByRole("checkbox", { name: "Включить на инстансе", exact: true }).check()
          await page.getByRole("button", { name: "Сохранить", exact: true }).click()
          await expect(page.getByText("Настройки сохранены", { exact: true })).toBeVisible()
          await page.goto("/settings")
          await page.getByRole("checkbox", { name: "Включить ассистента для семьи", exact: true }).check()
          await page.getByRole("checkbox", { name: "Я согласен на передачу перечисленных данных этому провайдеру.", exact: true }).check()
          await page.getByRole("button", { name: "Сохранить согласие", exact: true }).click()
          await expect(page.getByText("Настройки семьи сохранены", { exact: true })).toBeVisible()
          await db`update users set locale = ${locale} where email = ${email}`
          await page.goto("/dashboard")
          await page
            .getByTestId("ai-interview-entry")
            .getByRole("button", { name: locale === "ru" ? "Начать интервью" : "Start interview", exact: true })
            .click()
          await expect(page).toHaveURL(/assistant\?id=/)
          const id = new URL(page.url()).searchParams.get("id")!
          const progress = page.locator('[data-testid="ai-interview-progress"]:visible'),
            chips = page.getByTestId("ai-interview-chips")
          await expect(progress).toContainText(locale === "ru" ? "Шаг 1 из 5" : "Step 1 of 5")
          await expect(chips.getByRole("button")).toHaveCount(1)
          await expect(page.getByTestId("ai-status")).toHaveCount(0)
          // Rename the persisted conversation, using the current optimistic-concurrency version.
          await page.reload()
          await expectSingleAiFeed(page)
          const titlePrefix = locale === "ru" ? "Составление бюджета · " : "Budget setup · "
          const conversationLink = page.getByRole("link", { name: new RegExp(titlePrefix) })
          await expect(conversationLink).toBeVisible()
          await expect(
            conversationLink.getByRole("img", { name: locale === "ru" ? "Интервью по бюджету" : "Budget interview", exact: true }),
          ).toBeVisible()
          const automaticTitle = (await conversationLink.innerText()).trim()
          const menu = (title: string) =>
            page.getByRole("button", {
              name: locale === "ru" ? `Действия с диалогом «${title}»` : `Conversation actions: ${title}`,
              exact: true,
            })
          await menu(automaticTitle).click()
          await page.getByRole("menuitem", { name: locale === "ru" ? "Переименовать диалог" : "Rename conversation", exact: true }).click()
          const titleInput = page.getByLabel(locale === "ru" ? "Название диалога" : "Conversation title", { exact: true })
          const customTitle = locale === "ru" ? "Наш бюджет" : "Our budget"
          await titleInput.fill(customTitle)
          await page.getByRole("button", { name: locale === "ru" ? "Сохранить название" : "Save title", exact: true }).click()
          await expect(page.getByRole("dialog")).toHaveCount(0)
          await expect(chips.getByRole("button")).toHaveCount(1)
          await chips.getByRole("button").first().click()
          await expect(progress).toContainText(locale === "ru" ? "Шаг 2 из 5" : "Step 2 of 5")
          await expect(page.getByRole("link", { name: new RegExp(customTitle) })).toBeVisible()
          await expect(page.getByTestId("ai-status")).toHaveCount(0)
          await page.reload()
          await expectSingleAiFeed(page)
          await expect(progress).toContainText(locale === "ru" ? "Шаг 2 из 5" : "Step 2 of 5")
          await menu(customTitle).click()
          await page.getByRole("menuitem", { name: locale === "ru" ? "Переименовать диалог" : "Rename conversation", exact: true }).click()
          await page
            .getByRole("button", { name: locale === "ru" ? "Вернуть автоматическое название" : "Restore automatic title", exact: true })
            .click()
          await expect(page.getByRole("dialog")).toHaveCount(0)
          await expect(conversationLink).toContainText(automaticTitle)
          await expect(page.getByTestId("ai-status")).toHaveCount(0)
          await page.getByRole("link", { name: locale === "ru" ? "Продолжить позже" : "Continue later", exact: true }).click()
          await expect(page).toHaveURL(/dashboard/)
          await page.getByTestId("ai-interview-entry").getByRole("button").click()
          await expect(page).toHaveURL(new RegExp(id))
          await expect(progress).toContainText(locale === "ru" ? "Шаг 2 из 5" : "Step 2 of 5")
          await chips.getByRole("button").first().click()
          await expect(progress).toContainText(locale === "ru" ? "Шаг 3 из 5" : "Step 3 of 5")
          await expect(page.getByTestId("ai-status")).toHaveCount(0)
          {
            await page.setViewportSize({ width, height: width === 375 ? 812 : 950 })
            await page.emulateMedia({ colorScheme: theme })
            await page.reload()
            await expectSingleAiFeed(page)
            await expect(progress).toContainText(locale === "ru" ? "Шаг 3 из 5" : "Step 3 of 5")
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            await expect(chips.getByRole("button").first()).toBeEnabled()
            await screenshot(page, `${screenshots}/interview-${locale}-${width}-${theme}.png`)
          }
          await chips.getByRole("button").first().click()
          await expect(progress).toContainText(locale === "ru" ? "Шаг 4 из 5" : "Step 4 of 5")
          await expect(page.getByTestId("ai-status")).toHaveCount(0)
          await chips.getByRole("button").first().click()
          await expect(progress).toContainText(locale === "ru" ? "Шаг 5 из 5" : "Step 5 of 5")
          await expect(page.getByTestId("ai-status")).toHaveCount(0)
          await chips.getByRole("button").first().click()
          const proposal = page.getByTestId("ai-proposal")
          await expect(proposal).toBeVisible()
          await expectAiFeedHydration(context, page.url())
          await expectSingleAiFeed(page)
          await expect(page.getByTestId("ai-status")).toHaveCount(0)
          await expect(proposal.locator("dl")).toHaveCount(0)
          await expect(proposal).toContainText(locale === "ru" ? "Новая категория и лимит" : "New category and limit")
          await expect(proposal).toContainText(locale === "ru" ? "ручная копилка" : "manual savings")
          await expect(proposal).not.toContainText("RUB")
          expect(await db`select id from recurring_rules where household_id = ${family!.id}`).toHaveLength(0)
          expect(await db`select id from category_budgets where household_id = ${family!.id}`).toHaveLength(0)
          {
            await page.setViewportSize({ width, height: width === 375 ? 812 : 950 })
            await page.emulateMedia({ colorScheme: theme })
            await proposal.locator("..").evaluate((element) => element.scrollIntoView({ block: "start" }))
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
            await screenshot(page, `${screenshots}/plan-${locale}-${width}-${theme}.png`)
          }
          if (width === 375 && theme === "dark") {
            await proposal.getByRole("listitem").last().scrollIntoViewIfNeeded()
            await screenshot(page, `${screenshots}/plan-${locale}-375-dark.png`)
            await proposal.locator("..").evaluate((element) => element.scrollIntoView({ block: "start" }))
            await screenshot(page, `${screenshots}/plan-overview-${locale}-375-dark.png`)
          }
          await proposal.getByRole("button", { name: locale === "ru" ? "Применить выбранное" : "Apply selected", exact: true }).click()
          await expect(proposal).toContainText(locale === "ru" ? "Применено" : "Applied")
          expect(await db`select id from recurring_rules where household_id = ${family!.id}`).toHaveLength(4)
          expect(await db`select id from category_budgets where household_id = ${family!.id}`).toHaveLength(2)
          expect(await db`select id from goals where household_id = ${family!.id}`).toHaveLength(1)
          await proposal.getByRole("link", { name: locale === "ru" ? "Открыть календарь" : "Open calendar", exact: true }).click()
          await expect(page).toHaveURL(/calendar/)
          const [scheduled] =
            await db`select date::text as date from transactions where household_id = ${family!.id} and title = ${locale === "ru" ? "Семейный вечер" : "Family evening"} order by date limit 1`
          await page.goto(`/calendar?month=${String(scheduled!.date).slice(0, 7)}`)
          await expect(page.getByRole("main").last()).toContainText(locale === "ru" ? "Семейный вечер" : "Family evening")
          await page.goto("/dashboard")
          await expect(page.getByTestId("ai-interview-entry")).toHaveCount(0)
          const nextMonth = monthKey(addMonths(todayIn("Europe/Moscow"), 1))
          await page.goto(`/dashboard?month=${nextMonth}`)
          await expect(page.locator('[data-testid="planned-income"]:visible')).toContainText(/100[\s,\u00a0\u202f]*000/)
          expect(consoleErrors).toEqual([])
        } finally {
          await db.end()
          await context.close()
        }
      })
    }
}
