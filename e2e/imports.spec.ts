import { test, expect, type Page } from "@playwright/test"
import postgres from "postgres"
import { E2E_ENV, SETUP_TOKEN } from "../playwright.config"

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
const header = "account;date;amount;currency;description;external_id;status;mcc;bank_category"
const syntheticLines = [
  ...Array.from(
    { length: 22 },
    (_, i) =>
      `Основной счёт;2026-10-20;-${100 + i}.45;RUB;${i < 8 ? "PYATEROCHKA" : ["APTEKA PRIMER", "COFFEE PRIMER", "METRO PRIMER", "MAGAZIN PRIMER"][i % 4]};;posted;${i < 8 ? "5411" : ["5912", "5812", "4111", "5411"][i % 4]};`,
  ),
  "Основной счёт;2026-10-20;50000.00;RUB;Зарплата (пример);;posted;;Зарплата",
  "Основной счёт;2026-10-20;1500.00;RUB;Возврат (пример);;posted;;Возвраты",
  "Основной счёт;2026-10-20;-987.65;RUB;Уже учтённая покупка;;posted;5411;",
  "Основной счёт;2026-10-20;-43000.00;RUB;Платёж по ипотеке (пример);;posted;;Продукты",
  "Основной счёт;2026-10-20;-5200.00;RUB;Перевод в копилку;;posted;5411;",
  "Копилка импорта;2026-10-20;5200.00;RUB;Перевод со своей карты;;posted;;",
  "Основной счёт;2026-10-20;-650.00;RUB;Ожидает проводки;;pending;5411;",
  "Основной счёт;wrong-date;-750.00;RUB;Нераспознанная дата;;posted;5411;",
]
const csv = (lines: string[]) => [header, ...lines, ""].join("\r\n")

/** Only the isolated, freshly started Playwright database; never use DATABASE_URL from the shell. */
async function seedPreviewCandidates() {
  const db = postgres(E2E_ENV.DATABASE_URL, { max: 1 })
  try {
    const [owner] =
      await db`select u.id, hm.household_id from users u join household_members hm on hm.user_id = u.id where u.email = ${OWNER.email} and hm.role = 'owner'`
    if (!owner) throw new Error("Synthetic owner is missing")
    const [account] = await db`select id from financial_accounts where household_id = ${owner.household_id} and name = 'Основной счёт'`
    const [category] = await db`select id from categories where household_id = ${owner.household_id} and name = 'Ипотека'`
    if (!account || !category) throw new Error("Synthetic catalog is missing")
    await db`insert into financial_accounts (household_id, name, kind) values (${owner.household_id}, 'Копилка импорта', 'savings')`
    await db`insert into transactions (household_id, type, status, amount, title, date, category_id, account_id, created_by)
      values (${owner.household_id}, 'expense', 'planned', 4300000, 'Ипотека (пример)', '2026-10-20', ${category.id}, ${account.id}, ${owner.id}),
      (${owner.household_id}, 'expense', 'posted', 98765, 'Уже учтённая покупка', '2026-10-20', ${category.id}, ${account.id}, ${owner.id})`
  } finally {
    await db.end()
  }
}
async function upload(page: Page, lines = syntheticLines) {
  await page.goto("/transactions/import")
  await page
    .getByLabel("Выписка CSV / XLSX")
    .setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from(csv(lines)) })
  await page.getByRole("button", { name: "Прочитать файл", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Профиль", exact: true })).toBeVisible()
}
async function commit(page: Page, count: number) {
  await page.getByRole("button", { name: new RegExp(`^Импортировать ${count} `) }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Записать операции", exact: true }).click()
  await expect(page.getByText("Готово", { exact: true }).last()).toBeVisible()
  await expect(page.getByRole("link", { name: "Открыть операции", exact: true })).toBeVisible()
}

test("30-row statement: compact preview, filters, bulk actions, similar rule, mobile sheet, commit and repeat", async ({ page }) => {
  await loginOrSetup(page)
  await seedPreviewCandidates()
  await upload(page)
  await select(page, "Профиль", "Мастер колонок (в том числе Альфа / Сбер)")
  await select(page, "Колонка: Дата операции", "2. date")
  await select(page, "Колонка: Сумма", "3. amount")
  await select(page, "Колонка: Описание", "5. description")
  await select(page, "Колонка: Валюта", "4. currency")
  await select(page, "Колонка: Счёт в файле", "1. account")
  await select(page, "Колонка: Статус (posted / pending / rejected)", "7. status")
  await select(page, "Колонка: MCC", "8. mcc")
  await select(page, "Колонка: Категория банка", "9. bank_category")
  await page.getByLabel("Сохранить настройки новым профилем семьи (необязательно)").fill("Синтетический CSV E2E")
  await page.getByRole("button", { name: "Подготовить предпросмотр", exact: true }).click()
  await expect(page).toHaveURL(/batch=/)
  const originalBatch = page.url()
  await expect(page.getByTestId("import-row")).toHaveCount(30)
  const filters = page.getByRole("group", { name: "Фильтр строк" })
  await expect(filters.getByRole("button", { name: "Новые 24", exact: true })).toBeVisible()
  await expect(filters.getByRole("button", { name: "Дубли 1", exact: true })).toBeVisible()
  await expect(filters.getByRole("button", { name: "Переводы 2", exact: true })).toBeVisible()
  await expect(filters.getByRole("button", { name: "Плановые 1", exact: true })).toBeVisible()
  await expect(filters.getByRole("button", { name: "Ошибки 2", exact: true })).toBeVisible()
  await expect(page.getByRole("combobox", { name: "Категория: Платёж по ипотеке (пример)", exact: true })).toContainText("Ипотека")
  await expect(page.getByRole("toolbar")).toHaveCount(0)
  await filters.getByRole("button", { name: "Переводы 2", exact: true }).click()
  await expect(page.getByRole("button", { name: "Решение: Перевод в копилку", exact: true })).toContainText("Новая · возможен перевод")
  await page.getByRole("button", { name: "Решение: Перевод в копилку", exact: true }).click()
  await page.getByRole("menuitem", { name: /Свой перевод: строка/ }).click()
  await expect(page.getByTestId("import-row").first()).toContainText("Перевод → Копилка импорта")
  await filters.getByRole("button", { name: "Все 30", exact: true }).click()
  // Selection affects bulk actions, not which decisions are committed.
  await page.getByRole("checkbox", { name: "Выбрать: APTEKA PRIMER", exact: true }).first().check()
  await expect(page.getByRole("toolbar")).toBeVisible()
  await page.getByRole("toolbar").getByRole("button", { name: "Пропустить", exact: true }).click()
  await expect(page.getByRole("button", { name: "Решение: APTEKA PRIMER", exact: true }).first()).toContainText("Пропущена")
  await page.getByRole("checkbox", { name: "Выбрать: APTEKA PRIMER", exact: true }).first().check()
  await page.getByRole("toolbar").getByRole("button", { name: "Создать", exact: true }).click()
  await page.getByRole("checkbox", { name: "Выбрать: PYATEROCHKA", exact: true }).first().check()
  await page.getByRole("toolbar").getByRole("button", { name: "Категория…", exact: true }).click()
  await select(page, "Общая категория", "Расход · Прочее")
  await page.getByRole("combobox", { name: "Категория: PYATEROCHKA", exact: true }).first().click()
  await page.getByRole("option", { name: "Продукты", exact: true }).click()
  await expect(page.getByRole("listbox")).toBeHidden()
  await page.getByRole("button", { name: "Применить", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("для 8 строк")
  await page.getByRole("button", { name: "Применить и запомнить", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
  await page.getByRole("button", { name: "Создать правило категории с условиями", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("Правило категории")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toBeHidden()
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(page.getByText("Шаг 3 из 4 · Проверка", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Добавить операцию", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Изменить: PYATEROCHKA", exact: true }).first().click()
  await expect(page.getByRole("dialog")).toContainText("Решение")
  await select(page, "Категория: PYATEROCHKA", "Продукты")
  await page.getByRole("dialog").getByRole("button", { name: "Готово", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole("button", { name: "Импортировать 26 операций", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Импортировать 26 операций", exact: true }).scrollIntoViewIfNeeded()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: "work/import-preview-375.png", fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: "work/import-preview-desktop.png", fullPage: true })
  await commit(page, 26)
  await page.getByRole("link", { name: "Открыть операции", exact: true }).click()
  await page.goto("/transactions?q=PYATEROCHKA")
  await expect(page.getByText("PYATEROCHKA", { exact: true })).toHaveCount(8)
  await upload(page)
  await page.getByRole("button", { name: "Подготовить предпросмотр", exact: true }).click()
  await expect(page).toHaveURL(/batch=/)
  await expect(page.getByRole("button", { name: "Дубли 28", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Импортировать 0 операций", exact: true })).toBeEnabled()
  await page.screenshot({ path: "work/import-duplicates-desktop.png", fullPage: true })
  await commit(page, 0)
  await page.goto("/transactions?q=PYATEROCHKA")
  await expect(page.getByText("PYATEROCHKA", { exact: true })).toHaveCount(8)
  await page.goto(originalBatch)
  await page.getByRole("button", { name: "Отменить импорт", exact: true }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "Отменить импорт", exact: true }).click()
  await expect(page.getByText("Импорт отменён", { exact: true })).toBeVisible()
  await page.goto("/transactions?q=PYATEROCHKA")
  await expect(page.getByText("PYATEROCHKA", { exact: true })).toHaveCount(0)
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
  await expect(page.getByTestId("import-row")).toContainText("20 окт")
  await commit(page, 1)
  await page.goto("/transactions?q=SYNTHETIC+XLSX+SHOP")
  await expect(page.getByText("SYNTHETIC XLSX SHOP", { exact: true })).toHaveCount(1)
})

test("shows statement rows in pages of 100 and applies bulk category only to selected rows", async ({ page }) => {
  await loginOrSetup(page)
  const lines = Array.from({ length: 205 }, (_, i) => `Основной счёт;2026-09-01;-${200 + i}.12;RUB;PAGE SHOP ${i};;posted;5411;`)
  await upload(page, lines)
  await page.getByRole("button", { name: "Подготовить предпросмотр", exact: true }).click()
  await expect(page.getByTestId("import-row")).toHaveCount(100)
  await page.getByRole("button", { name: "Показать ещё 100", exact: true }).click()
  await expect(page.getByTestId("import-row")).toHaveCount(200)
  await page.getByRole("button", { name: "Показать ещё 100", exact: true }).click()
  await expect(page.getByTestId("import-row")).toHaveCount(205)
  await page.getByRole("checkbox", { name: "Выбрать: PAGE SHOP 0", exact: true }).check()
  await page.getByRole("toolbar").getByRole("button", { name: "Категория…", exact: true }).click()
  await select(page, "Общая категория", "Расход · Прочее")
  await expect(page.getByRole("combobox", { name: "Категория: PAGE SHOP 0", exact: true })).toContainText("Прочее")
  await expect(page.getByRole("combobox", { name: "Категория: PAGE SHOP 1", exact: true })).toContainText("Продукты")
})
