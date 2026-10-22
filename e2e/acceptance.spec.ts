import { expect, test, type Page } from "@playwright/test"
import { OAuth2Server } from "oauth2-mock-server"
import { SETUP_TOKEN } from "../playwright.config"

/**
 * The v1 acceptance scenario: first admin, household, recurring income with two accruals,
 * recurring payments, a budget limit, one-off expenses, forecast, confirming salary,
 * inviting the spouse who adds an expense visible to both.
 */

const ADMIN = { name: "Евгений", email: "owner@e2e.test", password: "owner-password-1" }
const SPOUSE = { name: "Анна", email: "spouse@e2e.test", password: "spouse-password-1" }

async function chooseOption(page: Page, trigger: string, option: string) {
  await page.getByRole("dialog").getByRole("combobox").filter({ hasText: trigger }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
}

async function addOperation(
  page: Page,
  op: { type?: "Расход" | "Доход" | "Перевод"; amount: string; category: string; title?: string; repeat?: { day: string; extra?: { day: string; amount: string } }; posted?: boolean },
) {
  await page.getByRole("button", { name: "Операция", exact: true }).first().click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("Новая операция")).toBeVisible()
  if (op.type) await dialog.getByRole("radio", { name: op.type, exact: true }).click()
  await dialog.getByLabel("Сумма").fill(op.amount)
  await chooseOption(page, "Выберите категорию", op.category)
  if (op.title) await dialog.getByLabel("Название").fill(op.title)
  if (op.repeat) {
    await dialog.getByText("Повторять регулярно").click()
    await dialog.getByLabel("День месяца").fill(op.repeat.day)
    if (op.repeat.extra) {
      await dialog.getByRole("button", { name: "Ещё начисление в месяце" }).click()
      const row = dialog.locator("div.grid-cols-\\[5rem_1fr_auto\\]").last()
      await row.locator("input[type=number]").fill(op.repeat.extra.day)
      await row.locator("input[inputmode=decimal]").fill(op.repeat.extra.amount)
    }
  }
  await dialog.getByRole("button", { name: "Добавить", exact: true }).click()
  await expect(dialog).toBeHidden()
}

const balanceCard = (page: Page) => page.getByTestId("actual-balance")

test.describe.serial("acceptance scenario", () => {
  let inviteUrl = ""

  test("first admin sets up the app and the household", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveURL(/\/setup/)
    await page.getByLabel("Токен настройки").fill(SETUP_TOKEN)
    await page.getByLabel("Имя").fill(ADMIN.name)
    await page.getByLabel("E-mail").fill(ADMIN.email)
    await page.getByLabel("Пароль", { exact: true }).fill(ADMIN.password)
    await page.getByLabel("Повторите пароль").fill(ADMIN.password)
    await page.getByRole("button", { name: "Создать администратора" }).click()

    await expect(page).toHaveURL(/\/onboarding/)
    await page.getByLabel("Название").fill("Семья E2E")
    await page.getByRole("button", { name: "Создать", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole("heading", { name: "Обзор" })).toBeVisible()
  })

  test("adds salary with two accruals, recurring payments, a budget and one-off expenses", async ({ page }) => {
    await login(page, ADMIN)
    await page.goto("/transactions")
    await addOperation(page, {
      type: "Доход",
      amount: "238000",
      category: "Зарплата",
      repeat: { day: "5", extra: { day: "20", amount: "128000" } },
    })
    await addOperation(page, { amount: "43000", category: "Кредиты", title: "Кредит", repeat: { day: "7" } })
    await addOperation(page, { amount: "8500", category: "ЖКХ", repeat: { day: "15" } })
    await addOperation(page, { amount: "5000", category: "Подписки", repeat: { day: "14" } })

    await page.goto("/transactions?tab=rules")
    await expect(page.getByText("Ежемесячно, 5-го числа")).toBeVisible()
    await expect(page.getByText("Ежемесячно, 20-го числа")).toBeVisible()
    await expect(page.getByText("Кредит", { exact: true })).toBeVisible()

    // One-off expenses, already done.
    await page.goto("/transactions")
    await addOperation(page, { amount: "3200", category: "Продукты", title: "Продукты на неделю" })
    await addOperation(page, { amount: "1800", category: "Рестораны и доставка", title: "Пицца" })
    await expect(page.getByText("Продукты на неделю")).toBeVisible()

    // Budget limit for groceries.
    await page.goto("/budgets")
    await page.getByRole("listitem").filter({ hasText: "Продукты" }).getByRole("button", { name: "Задать лимит" }).click()
    await page.getByLabel("Лимит в месяц").fill("30000")
    await page.getByRole("button", { name: "Сохранить" }).click()
    await expect(page.getByText(/потрачено\s+3\s200/)).toBeVisible()
    await expect(page.getByText(/осталось\s+26\s800/)).toBeVisible()
  })

  test("shows actual balance and forecast, confirming salary changes the actual balance", async ({ page }) => {
    await login(page, ADMIN)
    await page.goto("/dashboard")
    await expect(balanceCard(page)).toContainText("−5 000")

    // Next month: planned salary is part of the forecast but not of the actual balance.
    await page.getByRole("link", { name: "Следующий месяц" }).click()
    await expect(page.getByTestId("planned-income")).toContainText("366 000")
    await expect(balanceCard(page)).toContainText("−5 000")

    // Confirm the nearest salary from the upcoming list.
    await page.goto("/dashboard")
    const salary = page.getByRole("listitem").filter({ hasText: "Зарплата" }).filter({ hasText: "238 000" }).first()
    await salary.getByRole("button", { name: "Подтвердить" }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Подтвердить" }).click()
    await expect(balanceCard(page)).toContainText("233 000")
  })

  test("invites the spouse", async ({ page }) => {
    await login(page, ADMIN)
    await page.goto("/settings")
    await page.getByRole("button", { name: "Пригласить" }).click()
    await page.getByRole("button", { name: "Создать ссылку" }).click()
    inviteUrl = await page.getByLabel("Ссылка-приглашение").inputValue()
    expect(inviteUrl).toMatch(/\/invite\//)
  })

  test("spouse joins and adds an expense that both see", async ({ browser }) => {
    const spouseContext = await browser.newContext()
    const spouse = await spouseContext.newPage()
    await spouse.goto(inviteUrl)
    await expect(spouse.getByText("Семья E2E")).toBeVisible()
    await spouse.getByLabel("Имя").fill(SPOUSE.name)
    await spouse.getByLabel("E-mail").fill(SPOUSE.email)
    await spouse.getByLabel("Пароль", { exact: true }).fill(SPOUSE.password)
    await spouse.getByLabel("Повторите пароль").fill(SPOUSE.password)
    await spouse.getByRole("button", { name: "Создать аккаунт и присоединиться" }).click()
    await expect(spouse).toHaveURL(/\/dashboard/)

    // A member cannot reach system administration.
    await spouse.goto("/admin")
    await expect(spouse).toHaveURL(/\/dashboard/)

    await spouse.goto("/transactions")
    await addOperation(spouse, { amount: "2500", category: "Продукты", title: "Рынок" })
    await expect(spouse.getByText("Рынок")).toBeVisible()

    // The invitation link is single-use.
    const third = await (await browser.newContext()).newPage()
    await third.goto(inviteUrl)
    await expect(third.getByText("Приглашение недействительно")).toBeVisible()

    const ownerContext = await browser.newContext()
    const owner = await ownerContext.newPage()
    await login(owner, ADMIN)
    await owner.goto("/transactions")
    const row = owner.getByRole("listitem").filter({ hasText: "Рынок" })
    await expect(row).toContainText(SPOUSE.name)
    await owner.goto("/dashboard")
    await expect(balanceCard(owner)).toContainText("230 500")
  })
})

test("creates a USD account, quotes and posts a RUB transfer, and fits a phone screen", async ({ page }) => {
  await login(page, ADMIN)
  await page.goto("/admin?tab=rates")
  await page.getByLabel("Рублей за 1 USD").fill("95")
  await page.getByRole("button", { name: "Сохранить ручной курс" }).click()
  await expect(page.getByText("Ручной курс сохранён", { exact: true })).toBeVisible()

  await page.goto("/accounts")
  await page.getByRole("button", { name: "Счёт", exact: true }).click()
  let dialog = page.getByRole("dialog")
  await dialog.getByLabel("Название").fill("USD-накопления E2E")
  await dialog.getByLabel("Валюта счёта").click()
  await page.getByRole("option", { name: /^USD ·/ }).click()
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog).toBeHidden()
  const usdCard = page.getByRole("listitem").filter({ hasText: "USD-накопления E2E" })
  await expect(usdCard).toContainText("0 $")

  await page.getByRole("button", { name: "Перевод", exact: true }).click()
  dialog = page.getByRole("dialog")
  await chooseOption(page, "Выберите счёт", "USD-накопления E2E · USD")
  await dialog.getByLabel("Сумма", { exact: true }).fill("9500")
  await expect(dialog.getByLabel("Зачислено", { exact: true })).toHaveValue("100")
  await dialog.getByLabel("Зачислено", { exact: true }).fill("")
  await expect(dialog.getByLabel("Зачислено", { exact: true })).toHaveValue("")
  await dialog.getByLabel("Зачислено", { exact: true }).fill("99")
  await expect(dialog.getByText(/1 USD = 95,00 ₽ · ручной курс на/)).toBeVisible()
  await expect(dialog.getByText(/1 USD = .* ₽ · по суммам перевода/)).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "work/multicurrency-transfer-375.png", fullPage: true, animations: "disabled" })
  await dialog.getByRole("button", { name: "Добавить", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(usdCard).toContainText("99 $")
  await expect(page.getByRole("listitem").filter({ hasText: "Основной счёт" })).toContainText("221 000")
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "work/multicurrency-accounts-375.png", fullPage: true, animations: "disabled" })
  await page.goto("/dashboard")
  await expect(balanceCard(page)).toHaveCount(1)
  await expect(balanceCard(page).getByLabel("230 405 ₽", { exact: true })).toHaveText("230 405 ₽")
  await expect(balanceCard(page)).toHaveAttribute("title", /1 валютный счёт/)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "work/multicurrency-dashboard-375.png", fullPage: true, animations: "disabled" })
})

test.describe.serial("single sign-on (OIDC)", () => {
  const idp = new OAuth2Server()
  let identity: Record<string, unknown> = {}

  test.beforeAll(async () => {
    await idp.issuer.keys.generate("RS256")
    await idp.start(3299, "localhost")
    idp.service.on("beforeTokenSigning", (token) => Object.assign(token.payload, identity))
    idp.service.on("beforeUserinfo", (res) => {
      res.body = { ...identity }
      res.statusCode = 200
    })
  })
  test.afterAll(async () => {
    await idp.stop()
  })

  test("admin configures the provider in the UI and links it to the account", async ({ page }) => {
    identity = { sub: "owner-sub", email: ADMIN.email, email_verified: true, name: ADMIN.name }
    await login(page, ADMIN)
    await page.goto("/admin?tab=auth")
    await page.getByLabel("Issuer URL").fill(idp.issuer.url!)
    await page.getByRole("button", { name: "Проверить" }).click()
    await expect(page.getByText(/Провайдер доступен/)).toBeVisible()
    await page.getByLabel("Отображаемое название").fill("Keycloak")
    await page.getByLabel("Client ID").fill("bestbudget")
    await page.getByLabel("Client Secret").fill("e2e-client-secret")
    await page.getByText("Включить вход через SSO").click()
    await page.getByRole("button", { name: "Сохранить" }).last().click()
    await expect(page.getByText("Настройки SSO сохранены")).toBeVisible()

    // Local login cannot be disabled before SSO is linked to the admin — lock-out protection.
    await page.getByText("Вход по e-mail и паролю").click()
    await page.getByRole("button", { name: "Сохранить" }).first().click()
    await expect(page.getByText(/привяжите SSO к своему аккаунту/)).toBeVisible()

    await page.goto("/settings?tab=profile")
    await page.getByRole("button", { name: "Привязать Keycloak" }).click()
    await expect(page).toHaveURL(/\/settings\?tab=profile/)
    await expect(page.getByText("привязан", { exact: true })).toBeVisible()
  })

  test("linked user signs in with SSO; unknown SSO users need an invitation", async ({ browser }) => {
    identity = { sub: "owner-sub", email: ADMIN.email, email_verified: true, name: ADMIN.name }
    const page = await (await browser.newContext()).newPage()
    await page.goto("/login")
    await page.getByRole("button", { name: "Войти через Keycloak" }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByText(ADMIN.email)).toBeVisible()

    identity = { sub: "stranger-sub", email: "stranger@e2e.test", email_verified: true, name: "Stranger" }
    const stranger = await (await browser.newContext()).newPage()
    await stranger.goto("/login")
    await stranger.getByRole("button", { name: "Войти через Keycloak" }).click()
    await expect(stranger).toHaveURL(/\/login\?error=/)
    await expect(stranger.getByText(/Регистрация закрыта/)).toBeVisible()
  })

  test("an SSO identity with the same e-mail as a local account is not merged silently", async ({ browser }) => {
    identity = { sub: "impostor-sub", email: SPOUSE.email, email_verified: true, name: "Impostor" }
    const page = await (await browser.newContext()).newPage()
    await page.goto("/login")
    await page.getByRole("button", { name: "Войти через Keycloak" }).click()
    await expect(page).toHaveURL(/\/login\?error=/)
  })
})

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login")
  await page.getByLabel("E-mail").fill(user.email)
  await page.getByLabel("Пароль", { exact: true }).fill(user.password)
  await page.getByRole("button", { name: "Войти" }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}
