import { createHash, randomBytes } from "node:crypto"
import type { Browser } from "@playwright/test"
import { expect, test } from "./fixtures"
import { createE2eDb } from "./db"
import { screenshot } from "./matrix"
import { SETUP_TOKEN } from "../playwright.config"

/** Signs in a fresh synthetic owner with the mock assistant, opened on an empty conversation. */
async function openChat(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ serviceWorkers: "block", locale: "ru-RU", viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const db = createE2eDb()
  const email = `ai-md-${randomBytes(8).toString("hex")}@e2e.test`
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
  const [household] = await db`select id from households order by created_at limit 1`
  const token = randomBytes(24).toString("hex")
  await db`insert into invitations(household_id, token_hash, role, expires_at) values (${household!.id}, ${createHash("sha256").update(token).digest("hex")}, 'member', now() + interval '1 day')`
  await page.goto(`/invite/${token}`)
  await page.getByLabel("Имя", { exact: true }).fill("Markdown Demo")
  await page.getByLabel("E-mail").fill(email)
  await page.getByLabel("Пароль", { exact: true }).fill("markdown-password-123")
  await page.getByLabel("Повторите пароль").fill("markdown-password-123")
  await page.getByRole("button", { name: "Создать аккаунт и присоединиться", exact: true }).click()
  await expect(page).toHaveURL(/dashboard/)
  await page.goto("/onboarding?new=1")
  await page.getByLabel("Название", { exact: true }).fill(`Markdown family ${randomBytes(4).toString("hex")}`)
  await page.getByRole("button", { name: "Создать", exact: true }).click()
  await expect(page).toHaveURL(/dashboard/)
  await db`delete from household_members where user_id = (select id from users where email = ${email}) and role = 'member'`
  await db`update users set role = 'admin' where email = ${email}`
  await page.goto("/admin?tab=ai")
  await page.getByLabel("Провайдер", { exact: true }).selectOption("mock")
  await page.getByLabel("Модель", { exact: true }).fill("test-budget")
  await page.getByRole("checkbox", { name: "Включить на инстансе", exact: true }).check()
  await page.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(page.getByText("Настройки сохранены", { exact: true })).toBeVisible()
  await page.goto("/settings")
  await page.getByRole("checkbox", { name: "Включить ассистента для семьи", exact: true }).check()
  await page.getByRole("checkbox", { name: "Я согласен на передачу перечисленных данных этому провайдеру.", exact: true }).check()
  await page.getByRole("button", { name: "Сохранить согласие", exact: true }).click()
  await expect(page.getByText("Настройки семьи сохранены", { exact: true })).toBeVisible()
  await page.setViewportSize(viewport)
  await page.goto("/assistant")
  if (viewport.width < 1024) await page.getByRole("button", { name: "Диалоги", exact: true }).click()
  await page.getByRole("button", { name: "Новый диалог", exact: true }).click()
  await expect(page).toHaveURL(/assistant\?id=/)
  const chat = page.getByTestId("ai-chat").filter({ visible: true })
  return {
    page,
    chat,
    send: async (text: string) => {
      await page.getByRole("textbox", { name: "Спросите о бюджете…", exact: true }).fill(text)
      await page.getByRole("button", { name: "Отправить", exact: true }).click()
    },
    close: async () => {
      await db.end()
      await context.close()
    },
  }
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 375, height: 812 },
]) {
  test(`assistant renders GFM safely without raw markers (${viewport.width})`, async ({ browser }) => {
    test.setTimeout(60_000)
    const { page, chat, send, close } = await openChat(browser, viewport)
    try {
      const feed = chat.getByTestId("ai-messages")
      // No frame of the streamed answer may show raw markup, not only the final one.
      await feed.evaluate((el) => {
        const raw: string[] = []
        Object.assign(window, { __rawMarkup: raw })
        new MutationObserver(() => {
          if (/\||\*\*|~~|`|\]\(|<\w/.test(el.textContent ?? "")) raw.push(el.textContent ?? "")
        }).observe(el, { subtree: true, childList: true, characterData: true })
      })
      await send("Покажи разметку")
      const table = feed.getByRole("table")
      await expect(table).toBeVisible()
      await expect(feed).toContainText("Итог: всё сходится.")
      await expect(chat.getByRole("button", { name: "Отправить", exact: true })).toBeVisible()
      expect(await page.evaluate(() => (window as unknown as { __rawMarkup: string[] }).__rawMarkup)).toEqual([])

      await expect(table.getByRole("row")).toHaveCount(3)
      await expect(table.getByRole("columnheader", { name: "Текущий долг", exact: true })).toBeVisible()
      await expect(table.getByRole("cell", { name: "100 000,00 ₽", exact: true })).toHaveCSS("text-align", "right")
      await expect(table.getByRole("cell", { name: "100 000,00 ₽", exact: true })).toHaveCSS("white-space", "nowrap")
      await expect(feed.getByRole("heading", { name: "План по шагам", level: 2 })).toHaveCSS("font-weight", "600")
      await expect(feed.locator("li ul li")).toHaveText("Вложенный пункт")
      await expect(feed.locator("blockquote")).toContainText("Цитата с пояснением")
      await expect(feed.locator("pre code")).toContainText("const total = 100 + 200")
      await expect(feed.locator("del")).toHaveText("зачёркнутым")
      await expect(feed).toContainText("~5000 ₽ и ~6000 ₽")

      const link = feed.getByRole("link", { name: "Подробнее", exact: true })
      await expect(link).toHaveAttribute("href", "https://example.com/plan")
      await expect(link).toHaveAttribute("target", "_blank")
      await expect(link).toHaveAttribute("rel", "noopener noreferrer")

      await expect(feed.getByRole("link", { name: "Опасная ссылка", exact: true })).toHaveCount(0)
      await expect(feed).toContainText("Опасная ссылка")
      await expect(feed.locator("img, script")).toHaveCount(0)
      expect(await page.evaluate(() => "__mdInjected" in window)).toBe(false)

      await feed.evaluate((el) => {
        el.scrollTop = 0
      })
      await screenshot(page, `docs/screenshots/ai/markdown-ru-${viewport.width}.png`)
      await page.emulateMedia({ colorScheme: "dark" })
      await screenshot(page, `docs/screenshots/ai/markdown-ru-${viewport.width}-dark.png`)
      await page.emulateMedia({ colorScheme: "light" })

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (viewport.width === 375) {
        const container = table.locator("xpath=ancestor::*[@data-slot='table-container']")
        expect(await container.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
        expect(await feed.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
      }

      await page.reload()
      await expect(feed.getByRole("table")).toBeVisible()
      await expect(chat.getByTestId("ai-truncated")).toHaveCount(0)
    } finally {
      await close()
    }
  })
}

test("assistant flags a cut-off answer, hides the dangling marker and can continue", async ({ browser }) => {
  test.setTimeout(60_000)
  const { page, chat, send, close } = await openChat(browser, { width: 1280, height: 900 })
  try {
    const feed = chat.getByTestId("ai-messages")
    await send("Оборви ответ")
    const notice = chat.getByTestId("ai-truncated")
    await expect(notice).toContainText("лимит длины")
    await expect(feed).toContainText("Освободившиеся обязательные платежи")
    await expect(feed).not.toContainText("**")
    await screenshot(page, "docs/screenshots/ai/truncated-ru-1280.png")
    await page.reload()
    await expect(notice).toContainText("лимит длины")
    await expect(feed).not.toContainText("**")
    await notice.getByRole("button", { name: "Продолжить", exact: true }).click()
    await expect(feed).toContainText("Продолжи ответ с того места")
    await expect(notice.getByRole("button")).toHaveCount(0)
  } finally {
    await close()
  }
})

test("assistant feed follows new text only until the reader scrolls up", async ({ browser }) => {
  test.setTimeout(60_000)
  const { chat, send, close } = await openChat(browser, { width: 1280, height: 500 })
  try {
    const feed = chat.getByTestId("ai-messages")
    const distance = () => feed.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
    await send("Покажи разметку")
    await expect(feed).toContainText("Итог: всё сходится.")
    await expect.poll(distance).toBeLessThan(2)

    await send("Покажи разметку")
    await expect(chat.getByTestId("ai-status")).toHaveCount(0)
    await feed.evaluate((el) => {
      el.scrollTop -= 200
    })
    await expect(chat.getByRole("button", { name: "К последним сообщениям", exact: true })).toBeVisible()
    await expect(chat.getByRole("button", { name: "Отправить", exact: true })).toBeVisible({ timeout: 20_000 })
    expect(await distance()).toBeGreaterThan(100)

    await chat.getByRole("button", { name: "К последним сообщениям", exact: true }).click()
    await expect.poll(distance).toBeLessThan(2)
  } finally {
    await close()
  }
})

test("assistant animates new messages unless the reader prefers reduced motion", async ({ browser }) => {
  test.setTimeout(60_000)
  const { page, chat, send, close } = await openChat(browser, { width: 1280, height: 900 })
  try {
    const feed = chat.getByTestId("ai-messages")
    await send("Оборви ответ")
    await expect(chat.getByTestId("ai-truncated")).toBeVisible()
    await expect(feed.locator(".animate-in").first()).toHaveCSS("animation-name", "enter")

    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.reload()
    // History never animates, whatever the preference.
    await expect(chat.getByTestId("ai-truncated")).toBeVisible()
    await expect(feed.locator(".animate-in")).toHaveCount(0)
    await send("Помоги настроить бюджеты, пожалуйста")
    await expect(chat.getByTestId("ai-status").locator(".ai-dot").first()).toHaveCSS("animation-name", "none")
    await expect(feed.locator(".animate-in").first()).toHaveCSS("animation-name", "none")
  } finally {
    await close()
  }
})
