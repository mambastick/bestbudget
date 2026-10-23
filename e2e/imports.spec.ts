import { test, expect, type Page } from "@playwright/test"
import { SETUP_TOKEN } from "../playwright.config"

const OWNER = { email: "owner@e2e.test", password: "owner-password-1" }
async function loginOrSetup(page: Page) {
  await page.goto("/")
  if (page.url().includes("/setup")) {
    await page.getByLabel("Токен настройки").fill(SETUP_TOKEN)
    await page.getByLabel("Имя").fill("Евгений")
    await page.getByLabel("E-mail").fill(OWNER.email)
    await page.getByLabel("Пароль", { exact: true }).fill(OWNER.password)
    await page.getByLabel("Повторите пароль").fill(OWNER.password)
    await page.getByRole("button", { name: "Создать администратора" }).click()
    await expect(page).toHaveURL(/\/onboarding/)
    await page.getByLabel("Название").fill("Семья E2E")
    await page.getByRole("button", { name: "Создать", exact: true }).click()
  } else if (page.url().includes("/login")) {
    await page.getByLabel("E-mail").fill(OWNER.email)
    await page.getByLabel("Пароль", { exact: true }).fill(OWNER.password)
    await page.getByRole("button", { name: "Войти", exact: true }).click()
  }
  await expect(page).toHaveURL(/\/dashboard/)
}
async function select(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click()
  await page.getByRole("option", { name: option, exact: true }).click()
  await expect(page.getByRole("listbox")).toBeHidden()
}
const syntheticCsv =
  "account;date;amount;currency;description;external_id;status;mcc\r\nОсновной счёт;2026-10-20;-123.45;RUB;SYNTHETIC IMPORT SHOP;;posted;5411\r\n"

async function upload(page: Page) {
  await page.goto("/transactions/import")
  await page
    .getByLabel("Выписка CSV / XLSX")
    .setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from(syntheticCsv) })
  await page.getByRole("button", { name: "Прочитать файл", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Профиль", exact: true })).toBeVisible()
}

test("statement wizard, commit, repeat duplicates, undo and mobile layout", async ({ page }) => {
  await loginOrSetup(page)
  await upload(page)
  // Exercise the arbitrary-column wizard even though the input also has recognizable headers.
  await select(page, "Профиль", "Мастер колонок (в том числе Альфа / Сбер)")
  await select(page, "Колонка: Дата операции", "2. date")
  await select(page, "Колонка: Сумма", "3. amount")
  await select(page, "Колонка: Описание", "5. description")
  await select(page, "Колонка: Валюта", "4. currency")
  await select(page, "Колонка: Счёт в файле", "1. account")
  await select(page, "Колонка: Статус (posted / pending / rejected)", "7. status")
  await select(page, "Колонка: MCC", "8. mcc")
  await page.getByLabel("Сохранить настройки новым профилем семьи (необязательно)").fill("Синтетический CSV E2E")
  await page.getByRole("button", { name: "Подготовить предпросмотр", exact: true }).click()
  await expect(page).toHaveURL(/batch=/)
  await expect(page.getByTestId("import-row")).toHaveCount(1)
  await expect(page.getByTestId("import-row")).toContainText("SYNTHETIC IMPORT SHOP")
  await page.setViewportSize({ width: 375, height: 812 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: "work/import-preview-375.png", fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.screenshot({ path: "work/import-preview-desktop.png", fullPage: true })
  const originalBatch = page.url()
  await page.getByRole("button", { name: "Подтвердить импорт", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Записать операции", exact: true }).click()
  await expect(page.getByText("4. Готово", { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "К операциям", exact: true }).click()
  await expect(page.getByText("SYNTHETIC IMPORT SHOP", { exact: true })).toBeVisible()
  await upload(page)
  await page.getByRole("button", { name: "Подготовить предпросмотр", exact: true }).click()
  await expect(page).toHaveURL(/batch=/)
  await expect(page.getByTestId("import-row")).toContainText("Дубль / уже есть")
  await expect(page.getByRole("combobox", { name: "Решение для строки 1" })).toContainText("Пропустить")
  await page.screenshot({ path: "work/import-duplicates-desktop.png", fullPage: true })
  await page.getByRole("button", { name: "Подтвердить импорт", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Записать операции", exact: true }).click()
  await expect(page.getByText("4. Готово", { exact: true })).toBeVisible()
  await page.goto("/transactions?q=SYNTHETIC+IMPORT+SHOP")
  await expect(page.getByText("SYNTHETIC IMPORT SHOP", { exact: true })).toHaveCount(1)
  await page.goto(originalBatch)
  await page.getByRole("button", { name: "Отменить импорт", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Отменить импорт", exact: true }).click()
  await expect(page.getByText("Импорт отменён", { exact: true })).toBeVisible()
  await page.goto("/transactions?q=SYNTHETIC+IMPORT+SHOP")
  await expect(page.getByText("SYNTHETIC IMPORT SHOP", { exact: true })).toHaveCount(0)
})

test("reads a synthetic XLSX through the production upload route and rejects a foreign origin", async ({ page }) => {
  await loginOrSetup(page)
  const denied = await page.request.post("/api/import", { headers: { Origin: "https://foreign.invalid" }, data: "ignored" })
  expect(denied.status()).toBe(403)
  await page.goto("/transactions/import")
  await page.getByLabel("Выписка CSV / XLSX").setInputFiles("tests/fixtures/import/synthetic.xlsx")
  await page.getByRole("button", { name: "Прочитать файл", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Профиль", exact: true })).toContainText("BestBudget CSV v1")
  await page.getByRole("button", { name: "Подготовить предпросмотр", exact: true }).click()
  await expect(page.getByTestId("import-row")).toContainText("SYNTHETIC XLSX SHOP")
  await expect(page.getByTestId("import-row")).toContainText("2026-10-20")
  await page.getByRole("button", { name: "Подтвердить импорт", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Записать операции", exact: true }).click()
  await expect(page.getByText("4. Готово", { exact: true })).toBeVisible()
  await page.goto("/transactions?q=SYNTHETIC+XLSX+SHOP")
  await expect(page.getByText("SYNTHETIC XLSX SHOP", { exact: true })).toHaveCount(1)
})
