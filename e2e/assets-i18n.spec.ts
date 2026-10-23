import { execFileSync } from "node:child_process"
import { randomBytes, createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { expect, test, type Page } from "@playwright/test"
import postgres from "postgres"
import { E2E_ENV, SETUP_TOKEN } from "../playwright.config"
import { todayIn } from "../src/lib/dates"

const user = { name: "Assets Demo", email: "assets-i18n@e2e.test", password: "assets-password-1" }
const screenshotDir = "docs/screenshots/i18n/assets-import"

async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}
async function closeDialog(page: Page) {
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
}

// A separate user and household keep the Russian acceptance scenarios independent.
test("assets and import: seed demo in ru/en, both themes and widths, English actions and persisted warnings", async ({ browser }) => {
  test.setTimeout(300_000)
  const context = await browser.newContext({ locale: "ru-RU",
    timezoneId: "Europe/Moscow", viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" })
  const page = await context.newPage()
  const db = postgres(E2E_ENV.DATABASE_URL, { max: 1, onnotice: () => {} })
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  await mkdir(screenshotDir, { recursive: true })
  try {
    await page.goto("/login")
    if (page.url().includes("/setup")) {
      await page.getByLabel("Токен настройки").fill(SETUP_TOKEN)
      await page.getByLabel("Имя", { exact: true }).fill("Евгений")
      await page.getByLabel("E-mail").fill("owner@e2e.test")
      await page.getByLabel("Пароль", { exact: true }).fill("owner-password-1")
      await page.getByLabel("Повторите пароль").fill("owner-password-1")
      await page.getByRole("button", { name: "Создать администратора", exact: true }).click()
      await expect(page).toHaveURL(/\/onboarding/)
      await page.getByRole("button", { name: "Создать", exact: true }).click()
      await expect(page).toHaveURL(/\/dashboard/)
      await context.clearCookies()
    }
    const [household] = await db`select id from households order by created_at limit 1`
    if (!household) throw new Error("Synthetic household is missing")
    const token = randomBytes(24).toString("hex")
    await db`insert into invitations(household_id, token_hash, role, expires_at) values (${household.id}, ${createHash("sha256").update(token).digest("hex")}, 'member', now() + interval '1 day')`
    await page.goto(`/invite/${token}`)
    await page.getByLabel("Имя", { exact: true }).fill(user.name)
    await page.getByLabel("E-mail").fill(user.email)
    await page.getByLabel("Пароль", { exact: true }).fill(user.password)
    await page.getByLabel("Повторите пароль").fill(user.password)
    await page.getByRole("button", { name: "Создать аккаунт и присоединиться", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await page.goto("/onboarding?new=1")
    await page.getByLabel("Название", { exact: true }).fill("Assets i18n demo")
    await page.getByRole("button", { name: "Создать", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await db`delete from household_members where user_id=(select id from users where email=${user.email}) and role='member'`
    execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/seed-demo.ts", user.email], {
      env: { ...process.env, ...E2E_ENV },
      encoding: "utf8",
    })
    const [owner] =
      await db`select u.id, hm.household_id from users u join household_members hm on hm.user_id=u.id where u.email=${user.email} and hm.role='owner'`
    if (!owner) throw new Error("Synthetic owner is missing")
    const [loan] = await db`select id from loans where household_id=${owner.household_id} order by created_at limit 1`
    const [goal] = await db`select id from goals where household_id=${owner.household_id} and name='Семейный отпуск'`
    if (!loan || !goal) throw new Error("Seed demo is incomplete")
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
    const batchUrl = page.url()
    const routes = [
      "/accounts",
      "/loans",
      "/loans/new",
      `/loans/${loan.id}`,
      "/goals",
      `/goals/${goal.id}`,
      "/transactions/import",
      batchUrl,
    ]
    for (const locale of ["ru", "en"]) {
      // Exercise the same persisted batch in both languages, without recreating it.
      await db`update users set locale=${locale} where id=${owner.id}`
      for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 })
        for (const theme of ["light", "dark"]) {
          await page.evaluate((value) => localStorage.setItem("theme", value), theme)
          for (const route of routes) {
            await page.goto(route)
            await expect(page.locator("html")).toHaveAttribute("lang", locale)
            await expect(page.locator("html")).toHaveClass(new RegExp(theme))
            await noOverflow(page)
            if (route === "/accounts") {
              await expect(page.getByText(locale === "en" ? "How to track a credit card" : "Как учитывать кредитную карту")).toBeVisible()
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
            if (route === `/loans/${loan.id}`) {
              await page.getByRole("button", { name: locale === "en" ? "Prepayment" : "Досрочное погашение", exact: true }).click()
              await noOverflow(page)
              await closeDialog(page)
            }
            if (locale === "en" && theme === "dark" && width === 1280 && route === `/loans/${loan.id}`)
              await page.screenshot({ path: `${screenshotDir}/loans-en-desktop-dark.png`, fullPage: false, animations: "disabled" })
            if (locale === "en" && theme === "light" && width === 375 && route === `/goals/${goal.id}`)
              await page.screenshot({ path: `${screenshotDir}/goal-en-375-light.png`, fullPage: true, animations: "disabled" })
            if (locale === "en" && theme === "dark" && width === 375 && route === batchUrl)
              await page.screenshot({ path: `${screenshotDir}/import-en-375-dark.png`, fullPage: true, animations: "disabled" })
          }
        }
      }
    }
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
    expect(errors).toEqual([])
  } finally {
    await db.end()
    await context.close()
  }
})
