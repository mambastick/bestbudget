import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import type { Locator, TestInfo } from "@playwright/test"
import { test, expect, seedDemo, withDb, updateScreenshots, type StorageState, type Page } from "./matrix"
import { addMonths, todayIn } from "../src/lib/dates"
import { E2E_ENV } from "../playwright.config"

let state: StorageState
let memberState: StorageState
let householdId: string
const duplicateRu = "Активная категория с таким названием уже существует. Выберите другое название."

const operation = (page: Page) => page.getByRole("dialog", { name: "Операция", exact: true })
const row = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) }).filter({ visible: true })

async function fits(page: Page, target?: Locator) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (target) {
    const bounds = await target.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return [...element.querySelectorAll("button, input, [role=combobox], .tabular")].every((child) => {
        const item = child.getBoundingClientRect()
        return item.width === 0 || (item.left >= box.left - 1 && item.right <= box.right + 1)
      })
    })
    expect(bounds, "Controls and money must fit inside the dialog or calendar row").toBe(true)
  }
}

async function capture(page: Page, info: TestInfo, name: string) {
  if (!updateScreenshots) return
  // Keep review screenshots unobscured; normal test runs never wait for toast expiry.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0)
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: "disabled" })
  await info.attach(name, { path, contentType: "image/png" })
}

async function choose(page: Page, trigger: Locator, name: string) {
  await trigger.click()
  await page.getByRole("option", { name, exact: true }).click()
}

async function createExpense(page: Page, title: string) {
  await page.getByRole("button", { name: /^(Операция|Добавить операцию)$/ }).first().click()
  const dialog = page.getByRole("dialog", { name: "Новая операция", exact: true })
  await dialog.getByLabel("Сумма", { exact: true }).fill("1234,56")
  await choose(page, dialog.getByRole("combobox", { name: "Категория", exact: true }), "Продукты")
  await dialog.getByLabel("Название", { exact: true }).fill(title)
  await dialog.getByRole("button", { name: "Добавить", exact: true }).click()
  await expect(dialog).toBeHidden()
}

test.use({ serviceWorkers: "block", locale: "ru-RU", colorScheme: "light", reducedMotion: "reduce" })
test.setTimeout(60_000)

test.beforeAll(async ({ browser }) => {
  const seeded = await seedDemo(browser, "operation-edit", "Синтетическая семья операций")
  state = seeded.state
  householdId = seeded.household_id
  const email = `operation-member-${randomUUID()}@e2e.test`
  const password = "synthetic-member-password-1"
  execFileSync(process.execPath, ["--import", "tsx", "scripts/admin.ts", "create-admin"], {
    env: { ...process.env, ...E2E_ENV, ADMIN_NAME: "Участник примера", ADMIN_EMAIL: email, ADMIN_PASSWORD: password }, stdio: "pipe",
  })
  await withDb(async (db) => {
    const [member] = await db<{ id: string }[]>`update users set role='user', locale='ru' where email=${email} returning id`
    await db`insert into household_members (household_id, user_id, role) values (${householdId}, ${member!.id}, 'member')`
  })
  const context = await browser.newContext({ serviceWorkers: "block" })
  try {
    const response = await context.request.post("/api/auth/sign-in/email", { headers: { Origin: E2E_ENV.APP_URL }, data: { email, password } })
    expect(response.ok()).toBe(true)
    await context.addCookies(state.cookies.filter((cookie) => cookie.name === "bb_household"))
    memberState = await context.storageState()
  } finally { await context.close() }
})

test.beforeEach(async ({ context, page }) => {
  await context.addCookies(state.cookies)
  await page.addInitScript(() => localStorage.setItem("theme", "light"))
})

for (const width of [1280, 375]) {
  test(`calendar operation: edit type, inline category and both delete paths, ru light ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 })
    const title = `Синтетическая покупка ${width}`
    const categoryName = `Категория примера ${width}`
    await page.goto("/calendar")
    await expect(page).toHaveTitle("Календарь · BestBudget")
    await createExpense(page, title)
    await page.getByRole("radio", { name: "Список", exact: true }).click()
    await fits(page, row(page, title))
    await row(page, title).getByRole("button").first().click()
    let dialog = operation(page)
    await expect(dialog.getByRole("radio", { name: "Расход", exact: true })).toBeChecked()
    await dialog.getByRole("radio", { name: "Доход", exact: true }).click()
    await expect(dialog.getByRole("combobox", { name: "Категория", exact: true })).toContainText("Выберите категорию")
    await choose(page, dialog.getByRole("combobox", { name: "Категория", exact: true }), "Зарплата")
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(row(page, title)).toContainText("+1")

    await row(page, title).getByRole("button").first().click()
    dialog = operation(page)
    await expect(dialog.getByRole("radio", { name: "Доход", exact: true })).toBeChecked()
    await dialog.getByRole("radio", { name: "Перевод", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Новая категория", exact: true })).toHaveCount(0)
    await choose(page, dialog.getByRole("combobox").last(), "USD-накопления · USD")
    await dialog.getByLabel("Зачислено", { exact: true }).fill("777")
    await dialog.getByRole("radio", { name: "Расход", exact: true }).click()
    await dialog.getByRole("radio", { name: "Перевод", exact: true }).click()
    await choose(page, dialog.getByRole("combobox").last(), "USD-накопления · USD")
    await expect(dialog.getByLabel("Зачислено", { exact: true })).not.toHaveValue("777")
    await dialog.getByLabel("Зачислено", { exact: true }).fill("13")
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
    await expect(dialog).toBeHidden()

    await row(page, title).getByRole("button").first().click()
    dialog = operation(page)
    await expect(dialog.getByRole("radio", { name: "Перевод", exact: true })).toBeChecked()
    await dialog.getByRole("radio", { name: "Расход", exact: true }).click()
    await dialog.getByLabel("Описание", { exact: true }).fill("Заметка остаётся при создании категории")
    const amountBeforeCategory = await dialog.getByLabel("Сумма", { exact: true }).inputValue()
    // Closing a nested dialog must leave the operation and unsaved values intact.
    await dialog.getByRole("button", { name: "Новая категория", exact: true }).click()
    let nested = page.getByRole("dialog", { name: "Новая категория", exact: true })
    await expect(nested.getByRole("radio")).toHaveCount(0)
    await nested.getByLabel("Название", { exact: true }).fill("Закрываемый черновик")
    await nested.getByRole("button", { name: "Отмена", exact: true }).click()
    await expect(nested).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel("Сумма", { exact: true })).toHaveValue(amountBeforeCategory)
    await expect(dialog.getByLabel("Описание", { exact: true })).toHaveValue("Заметка остаётся при создании категории")

    await dialog.getByRole("button", { name: "Новая категория", exact: true }).click()
    nested = page.getByRole("dialog", { name: "Новая категория", exact: true })
    await nested.getByLabel("Название", { exact: true }).fill("Продукты")
    await nested.getByRole("button", { name: "Сохранить", exact: true }).click()
    await expect(nested.getByRole("alert")).toHaveText(duplicateRu)
    await nested.getByLabel("Название", { exact: true }).fill(categoryName)
    await fits(page, nested)
    await capture(page, info, `inline-category-${width}-light`)
    await nested.getByRole("button", { name: "Сохранить", exact: true }).click()
    await expect(nested).toBeHidden()
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("combobox", { name: "Категория", exact: true })).toContainText(categoryName)
    await expect(dialog.getByLabel("Название", { exact: true })).toHaveValue(title)
    await expect(dialog.getByLabel("Описание", { exact: true })).toHaveValue("Заметка остаётся при создании категории")
    // A bubbled submit would already have changed this persisted transfer into an expense.
    await withDb(async (db) => {
      const [saved] = await db`select type, description from transactions where household_id=${householdId} and title=${title}`
      expect(saved).toMatchObject({ type: "transfer", description: null })
    })
    await fits(page, dialog)
    await capture(page, info, `operation-dialog-${width}-light`)
    await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(row(page, title)).toContainText(categoryName)
    await row(page, title).getByRole("button").first().click()
    dialog = operation(page)
    await expect(dialog.getByRole("combobox", { name: "Категория", exact: true })).toContainText(categoryName)
    // Deletion is independent from validation and must never submit unsaved edits.
    await dialog.getByLabel("Сумма", { exact: true }).fill("")
    await dialog.getByRole("button", { name: "Удалить", exact: true }).click()
    const confirm = page.getByRole("alertdialog")
    await confirm.getByRole("button", { name: "Отмена", exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Удалить", exact: true }).click()
    await confirm.getByRole("button", { name: "Удалить", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(row(page, title)).toHaveCount(0)

    const menuTitle = `Синтетическая покупка для меню ${width}`
    await createExpense(page, menuTitle)
    await fits(page, row(page, menuTitle))
    await row(page, menuTitle).getByRole("button", { name: "Действия", exact: true }).click()
    await capture(page, info, `calendar-row-${width}-light`)
    await page.getByRole("menuitem", { name: "Удалить", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Удалить", exact: true }).click()
    await expect(row(page, menuTitle)).toHaveCount(0)
  })

  test(`member cannot create an inline category, ru ${width}px`, async ({ page, context }) => {
    await context.clearCookies()
    await context.addCookies(memberState.cookies)
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/calendar")
    await page.getByRole("button", { name: /^(Операция|Добавить операцию)$/ }).first().click()
    const dialog = page.getByRole("dialog", { name: "Новая операция", exact: true })
    await expect(dialog.getByRole("combobox", { name: "Категория", exact: true })).toBeVisible()
    await expect(dialog.getByRole("button", { name: "Новая категория", exact: true })).toHaveCount(0)
    await fits(page, dialog)
  })
}

test("calendar day panel: row menu and recurring type lock", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto("/calendar")
  const title = "Синтетическая строка с длинным названием в панели дня"
  await createExpense(page, title)
  const entry = row(page, title)
  await fits(page, entry)
  await entry.getByRole("button", { name: "Действия", exact: true }).click()
  await capture(page, info, "calendar-day-panel-320-light")
  await page.getByRole("menuitem", { name: "Изменить", exact: true }).click()
  await expect(operation(page)).toBeVisible()
  await operation(page).getByRole("button", { name: "Отмена", exact: true }).click()
  await page.goto("/transactions?tab=rules")
  const rule = page.getByRole("listitem").filter({ hasText: "Интернет и связь" }).filter({ visible: true }).first()
  await rule.getByRole("button").first().click()
  const dialog = page.getByRole("dialog", { name: "Регулярная операция", exact: true })
  await expect(dialog.getByRole("radio", { name: "Расход", exact: true })).toBeDisabled()
  await expect(dialog.getByRole("radio", { name: "Доход", exact: true })).toBeDisabled()
  await expect(dialog).toContainText("Тип операции из расписания изменить нельзя")
  await page.keyboard.press("ArrowRight")
  await expect(dialog.getByRole("radio", { name: "Расход", exact: true })).toBeChecked()
})

test("settings categories: duplicate create and rename have a clear localized error", async ({ page }) => {
  await page.goto("/settings?tab=categories")
  await page.getByRole("button", { name: "Добавить", exact: true }).first().click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Название", { exact: true }).fill("Продукты")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog.getByRole("alert")).toHaveText(duplicateRu)
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click()
  const category = row(page, "Продукты")
  await category.getByRole("button", { name: "Действия", exact: true }).click()
  await page.getByRole("menuitem", { name: "Изменить", exact: true }).click()
  await dialog.getByLabel("Название", { exact: true }).fill("Транспорт")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog.getByRole("alert")).toHaveText(duplicateRu)
})


test("virtual and loan rows keep a single confirm action; an occurrence stays type-locked and deletes as a skip", async ({ page }) => {
  const month = addMonths(todayIn("Europe/Moscow"), 6).slice(0, 7)
  await page.goto(`/calendar?month=${month}`)
  await page.getByRole("radio", { name: "Список", exact: true }).click()
  const virtual = row(page, "Яндекс Плюс")
  await expect(virtual.getByRole("button", { name: "Действия", exact: true })).toHaveCount(0)
  await expect(virtual.getByRole("button", { name: "Подтвердить", exact: true })).toHaveCount(1)
  const loan = row(page, "Платёж по кредиту: Семейная ипотека")
  await expect(loan.getByRole("button", { name: "Действия", exact: true })).toHaveCount(0)
  await expect(loan.getByRole("button", { name: "Подтвердить", exact: true })).toHaveCount(1)
  await virtual.getByRole("button").first().click()
  const dialog = page.getByRole("dialog", { name: "Операция из расписания", exact: true })
  await expect(dialog.getByRole("radio", { name: "Доход", exact: true })).toBeDisabled()
  await expect(dialog.getByRole("radio", { name: "Расход", exact: true })).toBeChecked()
  await expect(dialog).toContainText("Тип операции из расписания изменить нельзя")
  await dialog.getByRole("button", { name: "Удалить", exact: true }).click()
  await expect(page.getByRole("alertdialog")).toContainText("будет отмечена как пропущенная")
  await page.getByRole("alertdialog").getByRole("button", { name: "Удалить", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(virtual).toHaveCount(0)
  await page.reload()
  await page.getByRole("radio", { name: "Список", exact: true }).click()
  await expect(virtual).toHaveCount(0)
  await withDb(async (db) => {
    const [saved] = await db`select status from transactions where household_id=${householdId} and title='Яндекс Плюс' and date >= ${month + "-01"}`
    expect(saved?.status).toBe("skipped")
  })
})
