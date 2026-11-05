import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { getDb } from "@/db"
import { loanEvents, transactions } from "@/db/schema"
import { addDays, addMonths, todayIn } from "@/lib/dates"
import { confirmTelegramPayment } from "@/server/notifications/telegram"
import { createAccount, listAccounts } from "@/server/services/catalog"
import {
  addLoanEvent,
  cancelLoanEvent,
  closeLoan,
  confirmLoanPayment,
  createLoan,
  ensureLoansMaterialized,
  getLoan,
  updateLoan,
  updateLoanHolidayEnd,
  virtualLoanPayments,
  type LoanInput,
  type LoanUpdate,
} from "@/server/services/loans"
import { getCalendarMonth, getDashboard, projection } from "@/server/services/reports"
import { getTransaction } from "@/server/services/transactions"
import { setupHousehold } from "./helpers"

async function fixture(overrides: Partial<LoanInput> = {}) {
  const f = await setupHousehold("Кредиты")
  const today = todayIn(f.ctx.timezone)
  const input: LoanInput = {
    name: "Ипотека",
    lender: "Банк",
    kind: "mortgage",
    principal: 200_000_00,
    trackingBalance: 100_000_00,
    annualRate: "12",
    trackingDate: addDays(today, -1),
    startDate: addMonths(today, -36),
    firstPaymentDate: today,
    termMonths: 12,
    paymentDay: Number(today.slice(8)),
    scheduleType: "annuity",
    interestMethod: "monthly",
    paymentAccountId: f.mainAccount,
    ...overrides,
  }
  const loan = await createLoan(f.ctx, input)
  return { ...f, today, loan, input }
}

const details = (f: Awaited<ReturnType<typeof fixture>>): LoanUpdate => ({
  name: f.input.name,
  lender: f.input.lender,
  kind: f.input.kind,
  principal: f.input.principal,
  startDate: f.input.startDate,
  paymentAccountId: f.input.paymentAccountId,
})

const terms = (nextPaymentDate: string, overrides = {}) => ({
  annualRate: "12",
  nextPaymentDate,
  paymentDay: Number(nextPaymentDate.slice(8)),
  termMonths: 12,
  paymentAmount: null,
  scheduleType: "annuity" as const,
  interestMethod: "monthly" as const,
  ...overrides,
})

async function parts(id: string) {
  return getDb().select().from(transactions).where(eq(transactions.loanId, id)).orderBy(transactions.loanDueDate, transactions.loanPart)
}

async function confirmNext(f: Pick<Awaited<ReturnType<typeof fixture>>, "ctx" | "loan" | "today">) {
  const first = (await parts(f.loan.id)).find((p) => p.status === "planned")!
  const row = await getTransaction(f.ctx, first.id)
  await confirmLoanPayment(f.ctx, row.id, {
    version: row.version,
    date: f.today < row.date ? f.today : row.date,
    amount: row.amount,
    allocation: "principal",
  })
  return row
}

const version = async (f: { ctx: Awaited<ReturnType<typeof fixture>>["ctx"]; loan: { id: string } }) => (await getLoan(f.ctx, f.loan.id)).loan.version
const liability = async (f: Awaited<ReturnType<typeof fixture>>) =>
  (await listAccounts(f.ctx)).find((a) => a.id === f.loan.accountId)!

describe("editing a loan", () => {
  it("renames and describes a loan without touching its schedule", async () => {
    const f = await fixture()
    const before = await parts(f.loan.id)
    await updateLoan(f.ctx, f.loan.id, f.loan.version, { ...details(f), name: "Квартира", lender: "Другой банк", kind: "other", principal: 150_000_00 })
    const d = await getLoan(f.ctx, f.loan.id)
    expect(d.name).toBe("Квартира")
    expect(d.loan).toMatchObject({ lender: "Другой банк", kind: "other", principal: 150_000_00, version: f.loan.version + 1 })
    expect((await parts(f.loan.id)).map((p) => p.id)).toEqual(before.map((p) => p.id))
    expect(d.events).toEqual([])
    await expect(updateLoan(f.ctx, f.loan.id, f.loan.version, details(f))).rejects.toThrow("изменены")
  })

  it("rewrites everything from the start while the loan has no history", async () => {
    const f = await fixture()
    const trackingDate = addDays(f.today, -3)
    const nextPaymentDate = addMonths(f.today, 1)
    await updateLoan(f.ctx, f.loan.id, f.loan.version, {
      ...details(f),
      terms: { ...terms(nextPaymentDate, { annualRate: "6", termMonths: 24 }), trackingDate, trackingBalance: 80_000_00 },
    })
    const d = await getLoan(f.ctx, f.loan.id)
    expect(d.events).toEqual([])
    expect(d.debt).toBe(80_000_00)
    expect(d.loan).toMatchObject({ trackingDate, trackingBalance: 80_000_00, firstPaymentDate: nextPaymentDate, termMonths: 24 })
    expect(d.next?.date).toBe(nextPaymentDate)
    expect((await liability(f)).balance).toBe(-80_000_00)
    expect((await parts(f.loan.id)).every((p) => p.loanDueDate! >= nextPaymentDate)).toBe(true)
  })

  it("rejects a future tracking start, an amount below the balance and an issue date after tracking", async () => {
    const f = await fixture()
    const base = { ...details(f), terms: { ...terms(addMonths(f.today, 1)), trackingDate: f.input.trackingDate, trackingBalance: 100_000_00 } }
    await expect(updateLoan(f.ctx, f.loan.id, f.loan.version, { ...base, terms: { ...base.terms, trackingDate: addDays(f.today, 1) } })).rejects.toThrow("будущем")
    await expect(updateLoan(f.ctx, f.loan.id, f.loan.version, { ...base, principal: 90_000_00 })).rejects.toThrow("меньше")
    await expect(updateLoan(f.ctx, f.loan.id, f.loan.version, { ...base, startDate: f.today })).rejects.toThrow("позже")
    expect((await getLoan(f.ctx, f.loan.id)).loan.version).toBe(f.loan.version)
  })

  it("keeps confirmed payments and applies new terms as a correction after them", async () => {
    const f = await fixture()
    const paid = await confirmNext(f)
    const before = await getLoan(f.ctx, f.loan.id)
    const nextPaymentDate = addMonths(f.today, 2)
    await updateLoan(f.ctx, f.loan.id, before.loan.version, { ...details(f), terms: terms(nextPaymentDate, { annualRate: "9", termMonths: 6 }) })
    const d = await getLoan(f.ctx, f.loan.id)
    expect(d.rows[0]).toEqual(before.rows[0])
    expect(d.debt).toBe(before.debt)
    expect(d.next?.date).toBe(nextPaymentDate)
    expect(d.rows.filter((r) => r.kind === "scheduled").length).toBe(7)
    expect(d.terms.annualRate).toBe("9.000000")
    const [event] = d.events
    expect(event).toMatchObject({ type: "correction", date: f.today, termMonths: 6 })
    expect(event!.terms!.before).toMatchObject({ annualRate: "12.000000", remainingPayments: 11 })
    expect(event!.terms!.after).toMatchObject({ annualRate: "9.000000", nextPaymentDate, remainingPayments: 6 })
    const stored = await getTransaction(f.ctx, paid.id)
    expect(stored).toMatchObject({ status: "posted", amount: paid.amount, date: paid.date })
    expect((await parts(f.loan.id)).filter((p) => p.status === "planned").every((p) => p.loanDueDate! >= nextPaymentDate)).toBe(true)
    // A later edit from the same point restates the change and keeps the original record of prior terms.
    await updateLoan(f.ctx, f.loan.id, d.loan.version, { ...details(f), terms: terms(nextPaymentDate, { annualRate: "8", termMonths: 6 }) })
    const again = await getLoan(f.ctx, f.loan.id)
    expect(again.events).toHaveLength(1)
    expect(again.events[0]!.terms!.before.annualRate).toBe("12.000000")
    expect(again.terms.annualRate).toBe("8.000000")
    await expect(
      updateLoan(f.ctx, f.loan.id, again.loan.version, { ...details(f), terms: { ...terms(nextPaymentDate), trackingBalance: 50_000_00 } }),
    ).rejects.toThrow("нельзя менять")
    await expect(updateLoan(f.ctx, f.loan.id, again.loan.version, { ...details(f), terms: terms(f.today) })).rejects.toThrow("позже даты изменения")
    expect((await getLoan(f.ctx, f.loan.id)).events).toHaveLength(1)
  })

  it("moves future plans, but not posted ones, to a new payment account in the loan currency", async () => {
    const f = await fixture()
    await confirmNext(f)
    const other = await createAccount(f.ctx, { name: "Вторая карта", kind: "debit_card", openingBalance: 0 })
    const usd = await createAccount(f.ctx, { name: "USD", kind: "debit_card", currency: "USD", openingBalance: 0 })
    const v = await version(f)
    await expect(updateLoan(f.ctx, f.loan.id, v, { ...details(f), paymentAccountId: usd.id })).rejects.toThrow("валюте")
    await expect(updateLoan(f.ctx, f.loan.id, v, { ...details(f), paymentAccountId: f.loan.accountId })).rejects.toThrow("счёт оплаты")
    await updateLoan(f.ctx, f.loan.id, v, { ...details(f), paymentAccountId: other.id })
    const rows = await parts(f.loan.id)
    expect(rows.filter((r) => r.status === "posted").every((r) => r.accountId === f.mainAccount)).toBe(true)
    const planned = rows.filter((r) => r.status === "planned")
    expect(planned.length).toBeGreaterThan(0)
    expect(planned.every((r) => r.accountId === other.id)).toBe(true)
  })
})

describe("restructuring", () => {
  it("restates the debt with a ledger adjustment, closes unpaid slots and keeps prior terms", async () => {
    const f = await fixture()
    const dashboardBefore = await getDashboard(f.ctx, f.today)
    const next = addMonths(f.today, 1)
    await addLoanEvent(f.ctx, f.loan.id, f.loan.version, {
      type: "restructuring",
      date: f.today,
      balance: 110_000_00,
      ...terms(next, { annualRate: "15", termMonths: 36 }),
      note: "Допсоглашение №1",
    })
    const d = await getLoan(f.ctx, f.loan.id)
    expect(d.debt).toBe(110_000_00)
    expect((await liability(f)).balance).toBe(-110_000_00)
    expect(d.next?.date).toBe(next)
    expect(d.rows.find((r) => r.kind === "restructuring")).toMatchObject({ date: f.today, balance: 110_000_00 })
    expect(d.events[0]).toMatchObject({ type: "restructuring", balanceDelta: -10_000_00, note: "Допсоглашение №1" })
    expect(d.events[0]!.terms!.before).toMatchObject({ annualRate: "12.000000" })
    expect(d.events[0]!.terms!.after).toMatchObject({ annualRate: "15.000000", remainingPayments: 36, balance: 110_000_00 })
    // The slot due today was never paid: it is closed, not silently marked as paid, and the money did not move.
    const slot = (await parts(f.loan.id)).filter((p) => p.loanDueDate === f.today)
    expect(slot.every((p) => p.status === "skipped")).toBe(true)
    const dashboard = await getDashboard(f.ctx, f.today)
    expect(dashboard.balance).toBe(dashboardBefore.balance)
    expect(dashboard.debt).toBe(dashboardBefore.debt + 10_000_00)
    expect(dashboard.monthExpense).toBe(dashboardBefore.monthExpense)
  })

  it("uses the actual debt when no balance is given, and schedules a change ahead without one", async () => {
    const f = await fixture()
    await confirmNext(f)
    const debt = (await getLoan(f.ctx, f.loan.id)).debt
    const ahead = addMonths(f.today, 2)
    const v = await version(f)
    await expect(
      addLoanEvent(f.ctx, f.loan.id, v, { type: "restructuring", date: ahead, balance: 50_000_00, ...terms(addMonths(ahead, 1)) }),
    ).rejects.toThrow("Остаток")
    await addLoanEvent(f.ctx, f.loan.id, v, { type: "restructuring", date: ahead, ...terms(addMonths(ahead, 1), { termMonths: 24 }) })
    let d = await getLoan(f.ctx, f.loan.id)
    expect(d.debt).toBe(debt)
    expect(d.events[0]).toMatchObject({ balance: null, balanceDelta: null })
    expect(d.terms.annualRate).toBe("12.000000")
    // Payments due before a scheduled change can still be confirmed in order.
    await ensureLoansMaterialized(f.ctx, f.today)
    await confirmNext(f)
    d = await getLoan(f.ctx, f.loan.id)
    expect(d.posted).toHaveLength(2)
    expect(d.rows.filter((r) => r.kind === "scheduled" && r.date > ahead)).toHaveLength(24)
  })

  it("rejects a change before a confirmed payment and validates the new terms", async () => {
    const f = await fixture()
    await confirmNext(f)
    const v = await version(f)
    await expect(addLoanEvent(f.ctx, f.loan.id, v, { type: "restructuring", date: addDays(f.today, -1), ...terms(f.today) })).rejects.toThrow("по порядку")
    await expect(addLoanEvent(f.ctx, f.loan.id, v, { type: "restructuring", date: f.today, ...terms(f.today) })).rejects.toThrow("позже даты изменения")
    await expect(
      addLoanEvent(f.ctx, f.loan.id, v, { type: "restructuring", date: f.today, ...terms(addMonths(f.today, 1), { paymentAmount: 1 }) }),
    ).rejects.toThrow("не покрывает")
    expect((await getLoan(f.ctx, f.loan.id)).events).toEqual([])
  })

  it("reserves changes of terms for owners and admins, and hides other households' loans", async () => {
    const f = await fixture()
    const memberCtx = { ...f.ctx, role: "member" as const }
    const input = { type: "restructuring" as const, date: f.today, ...terms(addMonths(f.today, 1)) }
    await expect(addLoanEvent(memberCtx, f.loan.id, f.loan.version, input)).rejects.toThrow("прав")
    await expect(updateLoan(memberCtx, f.loan.id, f.loan.version, details(f))).rejects.toThrow("прав")
    await expect(cancelLoanEvent(memberCtx, f.loan.id, f.loan.version, f.loan.id)).rejects.toThrow("прав")
    await expect(updateLoanHolidayEnd(memberCtx, f.loan.id, f.loan.version, f.loan.id, f.today)).rejects.toThrow("прав")
    const stranger = await setupHousehold("Чужие")
    await expect(addLoanEvent(stranger.ctx, f.loan.id, f.loan.version, input)).rejects.toThrow("не найден")
    await expect(updateLoan(stranger.ctx, f.loan.id, f.loan.version, details(f))).rejects.toThrow("не найден")
    await expect(cancelLoanEvent(stranger.ctx, f.loan.id, f.loan.version, f.loan.id)).rejects.toThrow("не найден")
  })
})

describe("holidays", () => {
  const holiday = (date: string, endDate: string, overrides = {}) => ({
    type: "holiday" as const,
    date,
    endDate,
    mode: "no_payment" as const,
    interest: "deferred_end" as const,
    shift: "extend_term" as const,
    ...overrides,
  })

  it("removes payments in the period from plans, the calendar and the forecast", async () => {
    const f = await fixture()
    await confirmNext(f)
    const start = addMonths(f.today, 1)
    const end = addDays(addMonths(f.today, 4), -1)
    const before = await getLoan(f.ctx, f.loan.id)
    await addLoanEvent(f.ctx, f.loan.id, before.loan.version, holiday(start, end))
    const d = await getLoan(f.ctx, f.loan.id)
    expect(d.rows.filter((r) => r.kind === "holiday")).toHaveLength(3)
    // The record compares like with like: the debt before the first skipped payment, not after it would have been made.
    expect(d.events[0]!.terms!.before).toMatchObject({ balance: before.debt, nextPaymentDate: start, nextPayment: before.next!.payment })
    expect(d.events[0]!.terms!.after).toMatchObject({ balance: before.debt, nextPaymentDate: addMonths(f.today, 4) })
    expect(d.next?.date).toBe(addMonths(f.today, 4))
    expect(d.payoffDate! > before.payoffDate!).toBe(true)
    expect(d.debt).toBe(before.debt)
    await ensureLoansMaterialized(f.ctx, f.today)
    const inPeriod = (date: string) => date >= start && date <= end
    expect((await parts(f.loan.id)).some((p) => inPeriod(p.loanDueDate!))).toBe(false)
    expect((await virtualLoanPayments(f.ctx, f.today, addMonths(f.today, 12))).some((p) => inPeriod(p.date))).toBe(false)
    const month = await getCalendarMonth(f.ctx, start)
    expect(month.items.filter((e) => e.loanId === f.loan.id && inPeriod(e.date))).toEqual([])
    const next = (await virtualLoanPayments(f.ctx, f.today, addMonths(f.today, 12))).filter((p) => p.date === addMonths(f.today, 4))
    expect(next.reduce((s, p) => s + p.amount, 0)).toBe(before.next!.payment)
    const horizon = addMonths(f.today, 6)
    const forecast = await projection(f.ctx, f.today, horizon, f.today)
    const owed = d.rows.filter((r) => r.kind === "scheduled" && r.status === "planned" && r.date <= horizon).reduce((sum, r) => sum + r.payment, 0)
    expect(forecast.days.at(-1)!.balance).toBe(-before.rows[0]!.payment - owed)
  })

  it("plans interest alone and confirms it as one payment, including from Telegram", async () => {
    const f = await fixture()
    await confirmNext(f)
    const start = addDays(f.today, 1)
    const end = addMonths(f.today, 2)
    const v = await version(f)
    await addLoanEvent(f.ctx, f.loan.id, v, holiday(start, end, { mode: "interest_only", interest: null }))
    const planned = (await parts(f.loan.id)).filter((p) => p.status === "planned" && p.loanDueDate! <= end)
    expect(planned.length).toBeGreaterThan(0)
    expect(planned.every((p) => p.loanPart === "interest")).toBe(true)
    const debt = (await getLoan(f.ctx, f.loan.id)).debt
    await confirmTelegramPayment(f.owner.id, `pay:${planned[0]!.id}:${planned[0]!.version}`)
    const d = await getLoan(f.ctx, f.loan.id)
    expect(d.debt).toBe(debt)
    expect(d.posted).toHaveLength(2)
    expect(d.posted[1]).toMatchObject({ principal: 0, interest: planned[0]!.amount })
  })

  it("answers a stale Telegram button after its plan is replaced by a new schedule", async () => {
    const f = await fixture()
    const stale = (await parts(f.loan.id)).find((p) => p.loanDueDate !== f.today)!
    await updateLoan(f.ctx, f.loan.id, f.loan.version, { ...details(f), terms: terms(addDays(f.today, 3)) })
    await expect(confirmTelegramPayment(f.owner.id, `pay:${stale.id}:${stale.version}`)).rejects.toThrow("заменена новым графиком")
  })

  /**
   * A loan with its first payment confirmed and three more due by now, so a holiday can already be running or over.
   * Its day never needs clamping: on the 31st, three months back from today would land between payment dates.
   */
  async function running() {
    const today = todayIn("Europe/Moscow")
    const lastDue = Number(today.slice(8)) > 28 ? `${today.slice(0, 8)}28` : today
    const first = addMonths(lastDue, -3)
    const f = await fixture({ trackingDate: addDays(first, -1), firstPaymentDate: first, paymentDay: Number(first.slice(8)) })
    await confirmNext(f)
    return { ...f, lastDue }
  }

  it("does not move the ledger for capitalized interest ahead of the end date", async () => {
    const f = await fixture()
    await confirmNext(f)
    const before = await getLoan(f.ctx, f.loan.id)
    const debtBefore = (await getDashboard(f.ctx, f.today)).debt
    await addLoanEvent(f.ctx, f.loan.id, before.loan.version, holiday(addDays(f.today, 1), addMonths(f.today, 3), { interest: "capitalize" }))
    const d = await getLoan(f.ctx, f.loan.id)
    const capitalized = d.rows.find((r) => r.kind === "capitalization")!
    expect(capitalized.accrued).toBeGreaterThan(0)
    expect(d.events[0]!.balanceDelta).toBe(-capitalized.accrued!)
    expect(d.debt).toBe(before.debt)
    expect((await liability(f)).balance).toBe(-before.debt)
    expect((await getDashboard(f.ctx, f.today)).debt).toBe(debtBefore)
    expect(d.futureInterest).toBeGreaterThan(before.futureInterest)
  })

  it("adds capitalized interest to the debt once a holiday has ended, and keeps the debt and schedule in step", async () => {
    const f = await running()
    const before = await getLoan(f.ctx, f.loan.id)
    const dashboardBefore = await getDashboard(f.ctx, f.today)
    const start = addMonths(f.lastDue, -2)
    await addLoanEvent(f.ctx, f.loan.id, before.loan.version, holiday(start, addDays(f.lastDue, -1), { interest: "capitalize" }))
    const d = await getLoan(f.ctx, f.loan.id)
    const capitalized = d.rows.find((r) => r.kind === "capitalization")!
    expect(d.debt).toBe(before.debt + capitalized.accrued!)
    expect(capitalized.balance).toBe(d.debt)
    expect((await liability(f)).balance).toBe(-d.debt)
    const dashboard = await getDashboard(f.ctx, f.today)
    expect(dashboard.debt).toBe(dashboardBefore.debt + capitalized.accrued!)
    // Nothing was spent: capitalization is neither an expense nor a movement of liquid money.
    expect(dashboard.balance).toBe(dashboardBefore.balance)
    expect(dashboard.monthExpense).toBe(dashboardBefore.monthExpense)
    expect(d.next?.date).toBe(f.lastDue)
    expect((await parts(f.loan.id)).filter((p) => p.status === "planned" && p.loanDueDate! < f.lastDue)).toEqual([])
  })

  it("restates capitalized interest when a prepayment lowers the balance it accrues on", async () => {
    const f = await fixture()
    await confirmNext(f)
    await addLoanEvent(f.ctx, f.loan.id, await version(f), holiday(addMonths(f.today, 1), addMonths(f.today, 3), { interest: "capitalize" }))
    const before = (await getLoan(f.ctx, f.loan.id)).events[0]!.balanceDelta!
    await addLoanEvent(f.ctx, f.loan.id, await version(f), { type: "prepayment", date: f.today, amount: 50_000_00, mode: "reduce_payment" })
    const d = await getLoan(f.ctx, f.loan.id)
    const after = d.events.find((e) => e.type === "holiday")!.balanceDelta!
    expect(after).toBe(-d.rows.find((r) => r.kind === "capitalization")!.accrued!)
    expect(Math.abs(after)).toBeLessThan(Math.abs(before))
  })

  it("moves the end of a holiday, returning the payments outside the period to the plan", async () => {
    const f = await fixture()
    await confirmNext(f)
    await addLoanEvent(f.ctx, f.loan.id, await version(f), holiday(addDays(f.today, 1), addMonths(f.today, 6)))
    const [event] = (await getLoan(f.ctx, f.loan.id)).events
    const long = (await getLoan(f.ctx, f.loan.id)).rows.filter((r) => r.kind === "holiday").length
    await expect(updateLoanHolidayEnd(f.ctx, f.loan.id, await version(f), event!.id, addDays(f.today, -1))).rejects.toThrow("Каникулы")
    const end = addMonths(f.today, 1)
    await updateLoanHolidayEnd(f.ctx, f.loan.id, await version(f), event!.id, end)
    const d = await getLoan(f.ctx, f.loan.id)
    expect(d.rows.filter((r) => r.kind === "holiday").length).toBeLessThan(long)
    expect(d.next?.date).toBe(addMonths(f.today, 2))
    expect(d.events[0]).toMatchObject({ endDate: end })
    expect(d.events[0]!.terms!.after.nextPaymentDate).toBe(addMonths(f.today, 2))
    await expect(
      addLoanEvent(f.ctx, f.loan.id, d.loan.version, { type: "restructuring", date: addDays(f.today, 2), ...terms(addMonths(f.today, 2)) }),
    ).rejects.toThrow("Каникулы")
  })

  it("rejects a holiday over a confirmed payment or with unconfirmed payments before it", async () => {
    const f = await fixture({ trackingDate: addDays(todayIn("Europe/Moscow"), -40), firstPaymentDate: addDays(todayIn("Europe/Moscow"), -30), paymentDay: Number(addDays(todayIn("Europe/Moscow"), -30).slice(8)) })
    await expect(addLoanEvent(f.ctx, f.loan.id, f.loan.version, holiday(f.today, addMonths(f.today, 2)))).rejects.toThrow("предыдущие платежи")
    await confirmNext(f)
    const paidOn = (await getLoan(f.ctx, f.loan.id)).posted[0]!.dueDate
    await expect(addLoanEvent(f.ctx, f.loan.id, await version(f), holiday(paidOn, addMonths(f.today, 2)))).rejects.toThrow("по порядку")
  })

  it("refuses to close while deferred interest is still owed, once the debt itself is repaid", async () => {
    const f = await running()
    await addLoanEvent(f.ctx, f.loan.id, await version(f), holiday(addMonths(f.lastDue, -2), addDays(f.lastDue, -1)))
    await confirmNext(f)
    const { debt, loan } = await getLoan(f.ctx, f.loan.id)
    await addLoanEvent(f.ctx, f.loan.id, loan.version, { type: "prepayment", date: f.today, amount: debt, mode: "reduce_payment" })
    const d = await getLoan(f.ctx, f.loan.id)
    expect(d.debt).toBe(0)
    expect(d.next?.interest).toBeGreaterThan(0)
    await expect(closeLoan(f.ctx, f.loan.id, d.loan.version)).rejects.toThrow("проценты")
  })
})

describe("cancelling a change", () => {
  it("restores the schedule and unpaid slots, and refuses once payments follow", async () => {
    const f = await fixture()
    const before = await getLoan(f.ctx, f.loan.id)
    await addLoanEvent(f.ctx, f.loan.id, before.loan.version, { type: "restructuring", date: f.today, balance: 90_000_00, ...terms(addMonths(f.today, 1)) })
    const changed = await getLoan(f.ctx, f.loan.id)
    expect(changed.debt).toBe(90_000_00)
    await expect(cancelLoanEvent(f.ctx, f.loan.id, before.loan.version, changed.events[0]!.id)).rejects.toThrow("изменены")
    await cancelLoanEvent(f.ctx, f.loan.id, changed.loan.version, changed.events[0]!.id)
    const restored = await getLoan(f.ctx, f.loan.id)
    expect(restored.events).toEqual([])
    expect(restored.debt).toBe(before.debt)
    expect(restored.rows.map(({ id: _id, ...r }) => r)).toEqual(before.rows.map(({ id: _id, ...r }) => r))
    expect((await parts(f.loan.id)).every((p) => p.status === "planned")).toBe(true)

    await confirmNext(f)
    const paid = await getLoan(f.ctx, f.loan.id)
    await addLoanEvent(f.ctx, f.loan.id, paid.loan.version, { type: "rate_change", date: f.today, annualRate: "7" })
    const event = (await getLoan(f.ctx, f.loan.id)).events[0]!
    await cancelLoanEvent(f.ctx, f.loan.id, paid.loan.version + 1, event.id)
    expect((await getLoan(f.ctx, f.loan.id)).terms.annualRate).toBe("12.000000")
  })

  it("only reverts the latest change of contract, never prepayments or reconciliations", async () => {
    const f = await fixture()
    await confirmNext(f)
    await addLoanEvent(f.ctx, f.loan.id, await version(f), { type: "rate_change", date: addMonths(f.today, 1), annualRate: "7" })
    await addLoanEvent(f.ctx, f.loan.id, await version(f), { type: "rate_change", date: addMonths(f.today, 2), annualRate: "8" })
    const d = await getLoan(f.ctx, f.loan.id)
    await expect(cancelLoanEvent(f.ctx, f.loan.id, d.loan.version, d.events[0]!.id)).rejects.toThrow("последнее")
    await cancelLoanEvent(f.ctx, f.loan.id, d.loan.version, d.events[1]!.id)
    await addLoanEvent(f.ctx, f.loan.id, await version(f), { type: "prepayment", date: f.today, amount: 100_00, mode: "reduce_term" })
    const after = await getLoan(f.ctx, f.loan.id)
    await expect(cancelLoanEvent(f.ctx, f.loan.id, after.loan.version, after.events.find((e) => e.type === "prepayment")!.id)).rejects.toThrow("последнее")
    await expect(cancelLoanEvent(f.ctx, f.loan.id, after.loan.version, f.loan.id)).rejects.toThrow("не найдено")
    const stored = await getDb().select().from(loanEvents).where(and(eq(loanEvents.loanId, f.loan.id), eq(loanEvents.type, "rate_change")))
    expect(stored).toHaveLength(1)
  })
})
