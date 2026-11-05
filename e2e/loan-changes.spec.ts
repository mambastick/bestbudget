import type { Locator } from "@playwright/test"
import { test, expect, seedDemo, withDb, type Page, type StorageState } from "./matrix"

let state: StorageState
let ownerId: string
let mortgage: string
let consumer: string

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  const outside = await page.locator('[role="dialog"], [role="dialog"] input, [role="dialog"] button, main li, main button').evaluateAll((elements) => elements.filter((element) => {
    const box = element.getBoundingClientRect()
    return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1) && !element.closest(".overflow-x-auto")
  }).map((element) => `${element.tagName}: ${element.textContent?.slice(0, 60)}`))
  expect(outside).toEqual([])
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), animations: "disabled" })
}

/** WCAG contrast of text against the dialog panel; a canvas resolves any CSS color space to sRGB. */
function contrastOnDialog(text: Locator) {
  return text.evaluate((node) => {
    const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
    const luminance = (color: string) => {
      canvas.clearRect(0, 0, 1, 1)
      canvas.fillStyle = color
      canvas.fillRect(0, 0, 1, 1)
      const [r, g, b] = [...canvas.getImageData(0, 0, 1, 1).data].map((value) => {
        const channel = value / 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const foreground = luminance(getComputedStyle(node).color)
    const background = luminance(getComputedStyle(node.closest('[role="dialog"]')!).backgroundColor)
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
  })
}

/** Dialogs scroll inside themselves: the end of a long form has to be reachable on a phone. */
async function captureDialogEnd(page: Page, name: string) {
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: /^(Сохранить|Save)$/ }).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole("button", { name: /^(Сохранить|Save)$/ })).toBeInViewport()
  await capture(page, name)
}

test.use({ serviceWorkers: "block", locale: "ru-RU", colorScheme: "light", reducedMotion: "reduce" })
test.setTimeout(60_000)

test.beforeAll(async ({ browser }) => {
  const seeded = await seedDemo(browser, "loan-changes", "Синтетическая семья")
  state = seeded.state
  ownerId = seeded.id
  const rows = await withDb((sql) => sql<{ id: string; kind: string }[]>`select id, kind from loans where household_id = ${seeded.household_id}`)
  mortgage = rows.find((r) => r.kind === "mortgage")!.id
  consumer = rows.find((r) => r.kind === "consumer")!.id
})
test.beforeEach(async ({ context }) => {
  await context.addCookies(state.cookies)
})

test("edits a loan with history: terms apply after the last payment and prior terms stay visible", async ({ page }) => {
  await page.goto(`/loans/${mortgage}`)
  const paid = page.getByText("Оплачен", { exact: true }).filter({ visible: true })
  await expect(paid.first()).toBeVisible()
  const paidBefore = await paid.count()
  await page.getByRole("button", { name: "Редактировать", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Подтверждённые платежи и прошлые события не изменятся")
  await expect(dialog).not.toContainText("Что изменится")
  await dialog.getByLabel("Ставка, % годовых").fill("8")
  await dialog.getByRole("radio", { name: "Срок", exact: true }).click()
  await dialog.getByLabel("Ежемесячный платёж").fill("60000")
  await expect(dialog).toContainText("Что изменится")
  await expect(dialog.getByText("→").first()).toBeVisible()
  await fits(page)
  await capture(page, "edit-dialog-1280")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(/Условия изменены/)).toBeVisible()
  await expect(page.getByText(/Было: ставка 9,5%/)).toBeVisible()
  await expect(page.getByText(/Стало: ставка 8%, следующий платёж 60\s000/)).toBeVisible()
  await expect(paid).toHaveCount(paidBefore)
  await fits(page)
  await capture(page, "edit-saved-1280")
})

test("restructures with a new balance on a phone and records it in the schedule", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`/loans/${mortgage}`)
  await page.getByRole("button", { name: "Реструктуризация", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Основной долг на эту дату").fill("5000000")
  await dialog.getByLabel("Ставка, % годовых").fill("11")
  await dialog.getByLabel("Осталось платежей").fill("180")
  await dialog.getByLabel("Комментарий (необязательно)").fill("Допсоглашение №1")
  await expect(dialog).toContainText("Что изменится")
  await expect(dialog).toContainText(/→\s*5\s000\s000/)
  await fits(page)
  await capture(page, "restructure-dialog-375")
  await captureDialogEnd(page, "restructure-dialog-end-375")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText("Реструктуризация сохранена", { exact: true })).toBeVisible()
  await expect(page.getByText("5 000 000 ₽", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Допсоглашение №1", { exact: true })).toBeVisible()
  await expect(page.getByText("Реструктуризация", { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await fits(page)
  await capture(page, "restructure-saved-375")
})

test("adds a holiday with an interest choice, shows it everywhere, ends it early and cancels it", async ({ page }) => {
  await page.goto(`/loans/${consumer}`)
  await page.getByRole("button", { name: "Кредитные каникулы", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Не списываются: 6 платежей")
  await dialog.getByRole("combobox", { name: "Что с процентами за период" }).click()
  await page.getByRole("option", { name: "Прибавляются к долгу", exact: true }).click()
  await expect(dialog).toContainText("дальше на них тоже начисляются проценты")
  await dialog.getByRole("radio", { name: "Сохранить дату окончания", exact: true }).click()
  await dialog.getByRole("radio", { name: "Только проценты", exact: true }).click()
  await expect(dialog.getByRole("combobox", { name: "Что с процентами за период" })).toBeHidden()
  await dialog.getByRole("radio", { name: "Ничего", exact: true }).click()
  await dialog.getByRole("radio", { name: "Продлить срок", exact: true }).click()
  await fits(page)
  await capture(page, "holiday-dialog-1280")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText(/Каникулы без платежей до/)).toBeVisible()
  await expect(page.getByText("Запланировано", { exact: true })).toBeVisible()
  const skipped = page.getByText("Каникулы", { exact: true }).filter({ visible: true })
  await expect(skipped).toHaveCount(6)
  await expect(page.getByText(/начислено/).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText("Проценты в долг", { exact: true }).filter({ visible: true })).toHaveCount(1)
  await fits(page)
  await capture(page, "holiday-saved-1280")

  await page.setViewportSize({ width: 375, height: 812 })
  await fits(page)
  await capture(page, "holiday-saved-375")
  await page.getByRole("heading", { name: "События кредита" }).scrollIntoViewIfNeeded()
  await capture(page, "holiday-events-375")
  await page.getByRole("heading", { name: "График погашения" }).scrollIntoViewIfNeeded()
  await capture(page, "holiday-schedule-375")
  await page.getByRole("button", { name: "Изменить окончание", exact: true }).click()
  const end = page.getByRole("dialog")
  await expect(end.getByRole("heading", { name: "Окончание каникул" })).toBeVisible()
  await fits(page)
  await end.getByRole("button", { name: "Отмена", exact: true }).click()
  await expect(end).toBeHidden()

  await page.getByRole("button", { name: "Отменить", exact: true }).click()
  const confirm = page.getByRole("alertdialog")
  await confirm.getByRole("button", { name: "Отменить изменение", exact: true }).click()
  await expect(page.getByText("Изменение отменено", { exact: true })).toBeVisible()
  await expect(page.getByText(/Каникулы без платежей до/)).toBeHidden()
  await expect(skipped).toHaveCount(0)
})

test("rewrites a loan without history from the start and renames its account", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`/loans/${consumer}`)
  await page.getByRole("button", { name: "Редактировать", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("график пересчитается с начала учёта")
  await dialog.getByLabel("Название", { exact: true }).fill("Ремонт дачи")
  await dialog.getByLabel("Текущий остаток долга").fill("250000")
  await dialog.getByLabel("Осталось платежей").fill("12")
  await expect(dialog).toContainText(/→\s*250\s000/)
  await fits(page)
  await capture(page, "edit-fresh-375")
  await captureDialogEnd(page, "edit-fresh-end-375")
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("heading", { name: "Ремонт дачи" })).toBeVisible()
  await expect(page.getByText("250 000 ₽", { exact: true }).first()).toBeVisible()
  await fits(page)
})

for (const [width, height] of [[1280, 900], [375, 812]] as const) {
  test(`shows the new forms and history in the dark theme, ${width}px`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"))
    await page.setViewportSize({ width, height })
    await page.goto(`/loans/${consumer}`)
    await expect(page.locator("html")).toHaveClass(/dark/)
    const forms = [
      ["Редактировать", "edit", async (dialog: Locator) => dialog.getByLabel("Ставка, % годовых").fill("7")],
      ["Реструктуризация", "restructure", async () => {}],
      ["Кредитные каникулы", "holiday", async () => {}],
    ] as const
    for (const [button, name, change] of forms) {
      await page.getByRole("button", { name: button, exact: true }).click()
      const dialog = page.getByRole("dialog")
      await change(dialog)
      await expect(dialog).toContainText("Что изменится")
      await fits(page)
      await capture(page, `${name}-dark-${width}`)
      await captureDialogEnd(page, `${name}-dark-end-${width}`)
      // Both the unchanged and the previous values have to read as text on the dialog, not as dark on dark.
      for (const text of [dialog.locator("dd").first(), dialog.locator("dt").first()]) expect(await contrastOnDialog(text)).toBeGreaterThanOrEqual(4.5)
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click()
      await expect(dialog).toBeHidden()
    }
    await page.getByRole("button", { name: "Кредитные каникулы", exact: true }).click()
    await page.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click()
    await expect(page.getByRole("dialog")).toBeHidden()
    await page.getByRole("heading", { name: "События кредита" }).scrollIntoViewIfNeeded()
    await expect(page.getByText(/Было: ставка/)).toBeVisible()
    await fits(page)
    await capture(page, `history-dark-${width}`)
    await page.getByRole("heading", { name: "График погашения" }).scrollIntoViewIfNeeded()
    await capture(page, `schedule-dark-${width}`)
    await page.getByRole("button", { name: "Отменить", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "Отменить изменение", exact: true }).click()
    await expect(page.getByText(/Было: ставка/)).toBeHidden()
  })
}

test("offers the same forms in English", async ({ page }) => {
  await withDb((sql) => sql`update users set locale = 'en' where id = ${ownerId}`)
  try {
    await page.goto(`/loans/${consumer}`)
    await page.getByRole("button", { name: "Payment holiday", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: "Payment holiday" })).toBeVisible()
    await expect(dialog).toContainText("Not collected:")
    await expect(dialog).toContainText("What happens to interest for the period")
    await capture(page, "holiday-dialog-en-1280")
  } finally {
    await withDb((sql) => sql`update users set locale = 'ru' where id = ${ownerId}`)
  }
})
