import { addDays } from "../src/lib/dates"
import { test, expect, seedDemo, withDb, type Page } from "./matrix"

test.use({ serviceWorkers: "block", locale: "ru-RU", colorScheme: "light", reducedMotion: "reduce" })
test.setTimeout(120_000)

async function fits(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  const outside = await page.locator('[role="dialog"], [role="dialog"] input, [role="dialog"] button, [role="dialog"] li').evaluateAll((elements) =>
    elements.filter((element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1)
    }).map((element) => `${element.tagName}: ${element.textContent?.slice(0, 60)}`),
  )
  expect(outside).toEqual([])
}

/** The demo consumer loan starts today; backdating it makes eleven days of daily interest accrue before a full prepayment. */
async function repaidLoanWithInterest(page: Page, prefix: string) {
  const seeded = await seedDemo(page.context().browser()!, prefix, "Синтетическая семья")
  await page.context().addCookies(seeded.state.cookies)
  const [loan] = await withDb((sql) => sql<{ id: string; tracking_date: string }[]>`
    select id, tracking_date::text from loans where household_id = ${seeded.household_id} and kind = 'consumer'`)
  const start = addDays(loan!.tracking_date, -11)
  await withDb((sql) => sql`update loans set tracking_date = ${start}, start_date = ${start}, interest_method = 'daily_actual' where id = ${loan!.id}`)
  await page.goto(`/loans/${loan!.id}`)
  await page.getByRole("button", { name: "Досрочное погашение", exact: true }).click()
  const form = page.getByRole("dialog")
  await form.getByLabel("Сумма досрочного погашения").fill("300000")
  await expect(form).toContainText("Начисленные до даты досрочного погашения проценты")
  await form.getByRole("checkbox", { name: "Внести начисленные проценты этим же платежом" }).uncheck()
  await form.getByRole("button", { name: "Сохранить", exact: true }).click()
  await expect(form).toBeHidden()
  await expect(page.getByText("0 ₽", { exact: true }).first()).toBeVisible()
  return loan!.id
}

async function openClose(page: Page) {
  await page.getByRole("button", { name: "Закрыть кредит", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Осталось процентов")
  await expect(dialog).toContainText("Начислено за период")
  return dialog
}

for (const width of [1280, 375]) {
  test(`pays the remaining interest and closes the loan at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await repaidLoanWithInterest(page, `loan-close-pay-${width}`)
    const dialog = await openClose(page)
    await expect(dialog.getByRole("radio", { name: /Оплатить проценты и закрыть/ })).toBeChecked()
    await expect(dialog.getByLabel("Сумма процентов")).not.toHaveValue("")
    await fits(page)
    await page.screenshot({ path: test.info().outputPath(`close-pay-${width}.png`), animations: "disabled" })
    await dialog.getByRole("button", { name: "Оплатить проценты и закрыть", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText("Проценты оплачены, кредит закрыт")).toBeVisible()
    await expect(page.getByRole("button", { name: "Закрыть кредит", exact: true })).toHaveCount(0)
  })

  test(`closes without interest when the bank did not charge it at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const id = await repaidLoanWithInterest(page, `loan-close-waive-${width}`)
    const dialog = await openClose(page)
    await dialog.getByRole("radio", { name: /Банк не начислил/ }).check()
    await expect(dialog).toContainText("Проценты не спишутся")
    await expect(dialog.getByLabel("Сумма процентов")).toHaveCount(0)
    await fits(page)
    await page.screenshot({ path: test.info().outputPath(`close-waive-${width}.png`), animations: "disabled" })
    await dialog.getByRole("button", { name: "Закрыть без процентов", exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByText("Кредит закрыт без начисления процентов")).toBeVisible()
    const interest = await withDb((sql) => sql<{ n: number }[]>`
      select count(*)::int as n from transactions where loan_id = ${id} and loan_part = 'interest'`)
    expect(interest[0]!.n).toBe(0)
  })
}
