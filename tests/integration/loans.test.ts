import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { getDb } from "@/db"
import { financialAccounts, loanEvents, loans, transactions, exchangeRates } from "@/db/schema"
import { addDays, addMonths, startOfMonth, todayIn } from "@/lib/dates"
import { confirmTelegramPayment } from "@/server/notifications/telegram"
import { notificationSnapshot } from "@/server/notifications/snapshot"
import { createAccount, listAccounts, updateAccount } from "@/server/services/catalog"
import {
  createLoan,
  getLoan,
  listLoans,
  ensureLoansMaterialized,
  confirmLoanPayment,
  addLoanEvent,
  closeLoan,
  deleteLoan,
  materializeLoanPayment,
  virtualLoanPayments,
  type LoanInput,
} from "@/server/services/loans"
import { getCalendarMonth, getDashboard, getAnalytics, projection } from "@/server/services/reports"
import {
  confirmTransaction,
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
  exportTransactions,
} from "@/server/services/transactions"
import { setupHousehold } from "./helpers"

async function fixture(overrides: Partial<LoanInput> = {}) {
  const f = await setupHousehold("Кредиты")
  const today = todayIn(f.ctx.timezone)
  const trackingDate = addDays(today, -1)
  const input: LoanInput = {
    name: "Ипотека",
    lender: "Банк",
    kind: "mortgage",
    principal: 200_000_00,
    trackingBalance: 100_000_00,
    annualRate: "12",
    trackingDate,
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

async function parts(id: string) {
  return getDb().select().from(transactions).where(eq(transactions.loanId, id)).orderBy(transactions.loanDueDate, transactions.loanPart)
}

async function confirmFirst(
  f: Awaited<ReturnType<typeof fixture>>,
  extra = 0,
  allocation: "principal" | "interest" | "manual" = "principal",
) {
  const first = (await parts(f.loan.id)).find((p) => p.loanPart === "principal")!
  const row = await getTransaction(f.ctx, first.id)
  await confirmLoanPayment(f.ctx, row.id, {
    version: row.version,
    date: f.today,
    amount: row.amount + extra,
    allocation,
    principal: allocation === "manual" ? row.loanPrincipal + extra : undefined,
  })
  return row
}

describe("loans", () => {
  it("creates a negative liability account and idempotent two-part plans on the 62-day horizon", async () => {
    const f = await fixture()
    const before = await parts(f.loan.id)
    expect(before.length).toBeGreaterThanOrEqual(4)
    expect(before.every((r) => r.status === "planned" && r.date <= addDays(f.today, 62))).toBe(true)
    await Promise.all([ensureLoansMaterialized(f.ctx, f.today), ensureLoansMaterialized(f.ctx, f.today)])
    expect((await parts(f.loan.id)).map((r) => r.id)).toEqual(before.map((r) => r.id))
    const accounts = await listAccounts(f.ctx)
    expect(accounts.find((a) => a.id === f.loan.accountId)).toMatchObject({
      kind: "loan",
      openingBalance: -100_000_00,
      balance: -100_000_00,
    })
    const exported = await exportTransactions(f.ctx, {})
    expect(exported).toHaveLength(before.length)
    expect(exported.filter((r) => r.type === "transfer").reduce((s, r) => s + r.amount, 0)).toBe(
      before.filter((r) => r.loanPart === "principal").reduce((s, r) => s + r.amount, 0),
    )
    const expenseExport = await exportTransactions(f.ctx, { type: "expense" })
    expect(expenseExport.every((r) => r.type === "expense")).toBe(true)
    const display = await listTransactions(f.ctx, {})
    expect(display.rows.length).toBe(before.length / 2)
    const expenseFilter = await listTransactions(f.ctx, { type: "expense", categoryId: f.loan.interestCategoryId })
    expect(expenseFilter.rows).toHaveLength(display.rows.length)
    expect(display.rows[0]!.title).toContain("Ипотека")
    expect((await getDashboard(f.ctx, f.today)).netAssets).toBe(-100_000_00)
  })

  it("confirms both parts atomically: full debit, principal-only debt reduction, interest-only expense", async () => {
    const f = await fixture()
    const row = await confirmFirst(f)
    const accounts = await listAccounts(f.ctx)
    expect(accounts.find((a) => a.id === f.mainAccount)!.balance).toBe(-row.amount)
    expect(accounts.find((a) => a.id === f.loan.accountId)!.balance).toBe(-100_000_00 + row.loanPrincipal)
    expect((await parts(f.loan.id)).filter((r) => r.status === "posted")).toHaveLength(2)
    const analytics = await getAnalytics(f.ctx, startOfMonth(f.today), f.today)
    expect(analytics.current.expense).toBe(row.loanInterest)
    await expect(
      confirmLoanPayment(f.ctx, row.id, { version: row.version, date: f.today, amount: row.amount, allocation: "principal" }),
    ).rejects.toThrow()
  })

  it.each(["principal", "interest", "manual"] as const)("supports actual amount allocation to %s", async (allocation) => {
    const f = await fixture()
    const row = await confirmFirst(f, 1000_00, allocation)
    const d = await getLoan(f.ctx, f.loan.id)
    expect(d.debt).toBe(100_000_00 - row.loanPrincipal - (allocation === "interest" ? 0 : 1000_00))
    expect(d.paidInterest).toBe(row.loanInterest + (allocation === "interest" ? 1000_00 : 0))
  })

  it("recalculates plans after early repayment without touching posted or user-edited plans", async () => {
    const f = await fixture()
    await confirmFirst(f)
    const before = await parts(f.loan.id)
    const edited = before.find((p) => p.status === "planned" && p.loanPart === "principal")!
    await getDb().update(transactions).set({ version: 2, description: "User edit" }).where(eq(transactions.id, edited.id))
    const d = await getLoan(f.ctx, f.loan.id)
    await addLoanEvent(f.ctx, f.loan.id, d.loan.version, { type: "prepayment", date: f.today, amount: 10_000_00, mode: "reduce_term" })
    const after = await parts(f.loan.id)
    for (const posted of before.filter((r) => r.status === "posted")) expect(after.find((r) => r.id === posted.id)).toEqual(posted)
    expect(after.find((r) => r.id === edited.id)).toEqual({
      ...edited,
      version: 2,
      description: "User edit",
      updatedAt: after.find((r) => r.id === edited.id)!.updatedAt,
    })
    const untouchedInterest = before.find((p) => p.loanDueDate === edited.loanDueDate && p.loanPart === "interest")!
    expect(after.find((r) => r.id === untouchedInterest.id)).toBeDefined()
    const newDetail = await getLoan(f.ctx, f.loan.id)
    expect(newDetail.debt).toBe(d.debt - 10_000_00)
    expect(newDetail.payoffDate! < d.payoffDate!).toBe(true)
  })

  it("caps a full prepayment at actual debt and closes without losing posted history", async () => {
    const f = await fixture()
    await confirmFirst(f)
    const current = await getLoan(f.ctx, f.loan.id)
    await addLoanEvent(f.ctx, f.loan.id, current.loan.version, {
      type: "prepayment",
      date: f.today,
      amount: 200_000_00,
      mode: "reduce_term",
    })
    const paid = await getLoan(f.ctx, f.loan.id)
    expect(paid.debt).toBe(0)
    expect(paid.events[0]!.amount).toBe(current.debt)
    expect((await parts(f.loan.id)).some((r) => r.status === "planned")).toBe(false)
    await closeLoan(f.ctx, f.loan.id, paid.loan.version)
    await ensureLoansMaterialized(f.ctx, addMonths(f.today, 5))
    expect((await parts(f.loan.id)).filter((r) => r.status === "posted")).toHaveLength(3)
  })

  it("serializes concurrent confirmations and rolls back an invalid allocation", async () => {
    const f = await fixture()
    const row = await getTransaction(f.ctx, (await parts(f.loan.id)).find((r) => r.loanPart === "principal")!.id)
    await expect(
      confirmLoanPayment(f.ctx, row.id, {
        version: row.version,
        date: f.today,
        amount: row.amount,
        allocation: "manual",
        principal: row.amount + 1,
      }),
    ).rejects.toThrow("разбивку")
    expect((await parts(f.loan.id)).every((r) => r.status === "planned")).toBe(true)
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        confirmLoanPayment(f.ctx, row.id, { version: row.version, date: f.today, amount: row.amount, allocation: "principal" }),
      ),
    )
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect((await parts(f.loan.id)).filter((r) => r.status === "posted")).toHaveLength(2)
  })

  it("projects virtual payments beyond the horizon and materializes a single slot once", async () => {
    const f = await fixture()
    const future = addMonths(f.today, 5)
    const virtual = await virtualLoanPayments(f.ctx, startOfMonth(future), addMonths(startOfMonth(future), 1))
    expect(virtual.length).toBeGreaterThan(0)
    const calendar = await getCalendarMonth(f.ctx, future)
    const item = calendar.items.find((p) => p.loanId === f.loan.id)!
    expect(item.virtual).toBe(true)
    expect(calendar.items.filter((p) => p.loanId === f.loan.id)).toHaveLength(1)
    const day = calendar.days.find((p) => p.date === item.date)!
    const previousDay = calendar.days.find((p) => p.date === addDays(item.date, -1))!
    expect(previousDay.balance - day.balance).toBe(item.amount)
    const id1 = await materializeLoanPayment(f.ctx, f.loan.id, item.date)
    const id2 = await materializeLoanPayment(f.ctx, f.loan.id, item.date)
    expect(id1).toBe(id2)
    expect(await virtualLoanPayments(f.ctx, item.date, item.date)).toHaveLength(0)
  })

  it("includes principal plus interest in cash-gap forecasts and obligations, while net assets exclude double spending", async () => {
    const f = await fixture()
    const row = await getTransaction(f.ctx, (await parts(f.loan.id)).find((r) => r.loanPart === "principal")!.id)
    const p = await projection(f.ctx, f.today, f.today, f.today)
    expect(p.days[0]!.balance).toBe(-row.amount)
    const d = await getDashboard(f.ctx, f.today)
    expect(d.balance).toBe(0)
    expect(d.debt).toBe(100_000_00)
    expect(d.netAssets).toBe(-100_000_00)
    expect(d.availableAfterObligations).toBeLessThanOrEqual(-row.amount)
  })

  it("reconciles debt without an expense and uses a dated adjustment for historical projections", async () => {
    const f = await fixture()
    await confirmFirst(f)
    const current = await getLoan(f.ctx, f.loan.id)
    const date = addDays(f.today, -1)
    await expect(
      addLoanEvent(f.ctx, f.loan.id, current.loan.version, { type: "reconciliation", date, balance: 50_000_00 }),
    ).rejects.toThrow()
    await addLoanEvent(f.ctx, f.loan.id, current.loan.version, { type: "reconciliation", date: f.today, balance: 50_000_00 })
    const after = await getLoan(f.ctx, f.loan.id)
    expect(after.debt).toBe(50_000_00)
    expect((await listAccounts(f.ctx)).find((a) => a.id === f.loan.accountId)!.balance).toBe(-50_000_00)
    expect(after.paidInterest).toBe(current.paidInterest)
    expect((await getDashboard(f.ctx, f.today)).netAssets).toBe(-50_000_00 - current.posted[0]!.principal - current.paidInterest)
  })

  it("changes rates, enforces versions and rejects backdated/future changes", async () => {
    const f = await fixture()
    await confirmFirst(f)
    const d = await getLoan(f.ctx, f.loan.id)
    await addLoanEvent(f.ctx, f.loan.id, d.loan.version, { type: "rate_change", date: f.today, annualRate: "6" })
    expect((await getLoan(f.ctx, f.loan.id)).futureInterest).toBeLessThan(d.futureInterest)
    await expect(addLoanEvent(f.ctx, f.loan.id, d.loan.version, { type: "rate_change", date: f.today, annualRate: "7" })).rejects.toThrow(
      "изменены",
    )
    await expect(
      addLoanEvent(f.ctx, f.loan.id, d.loan.version + 1, { type: "rate_change", date: addDays(f.today, 1), annualRate: "7" }),
    ).rejects.toThrow()
  })

  it("isolates households at service and composite-FK levels", async () => {
    const f = await fixture()
    const other = await setupHousehold("Other")
    await expect(getLoan(other.ctx, f.loan.id)).rejects.toThrow("не найден")
    expect(await listLoans(other.ctx)).toHaveLength(0)
    await expect(createLoan(other.ctx, { ...f.input, paymentAccountId: f.mainAccount })).rejects.toThrow()
    await expect(
      getDb()
        .insert(loanEvents)
        .values({ householdId: other.ctx.householdId, loanId: f.loan.id, type: "rate_change", date: f.today, annualRate: "5" }),
    ).rejects.toThrow()
    await expect(getDb().update(loans).set({ paymentAccountId: other.mainAccount }).where(eq(loans.id, f.loan.id))).rejects.toThrow()
    await expect(
      getDb()
        .insert(transactions)
        .values({
          householdId: other.ctx.householdId,
          loanId: f.loan.id,
          loanPaymentKey: "cross",
          loanDueDate: f.today,
          loanPart: "principal",
          type: "transfer",
          status: "planned",
          amount: 10,
          title: "Cross",
          accountId: other.mainAccount,
          toAccountId: f.loan.accountId,
          date: f.today,
        }),
    ).rejects.toThrow()
  })

  it("exposes one complete notification payment and confirms both parts through Telegram", async () => {
    const f = await fixture()
    const snapshot = await notificationSnapshot(f.ctx, new Date())
    const payments = snapshot.payments.filter((r) => r.title.includes("Ипотека"))
    const first = payments[0]!
    expect(payments.filter((r) => r.date === first.date)).toHaveLength(1)
    const current = await getTransaction(f.ctx, first.id)
    await confirmTelegramPayment(f.owner.id, `pay:${first.id}:${first.version}`)
    expect((await parts(f.loan.id)).filter((r) => r.status === "posted")).toHaveLength(2)
    expect((await listAccounts(f.ctx)).find((a) => a.id === f.mainAccount)!.balance).toBe(-current.amount)
    expect((await getLoan(f.ctx, f.loan.id)).debt).toBe(100_000_00 - current.loanPrincipal)
  })

  it("lets members confirm payments but reserves loan management for owner/admin", async () => {
    const f = await fixture()
    const member = { ...f.ctx, role: "member" as const }
    await expect(createLoan(member, f.input)).rejects.toThrow("прав")
    await expect(addLoanEvent(member, f.loan.id, 1, { type: "rate_change", date: f.today, annualRate: "1" })).rejects.toThrow("прав")
    expect((await getLoan(member, f.loan.id)).name).toBe("Ипотека")
    const row = await getTransaction(member, (await parts(f.loan.id)).find((p) => p.loanPart === "principal")!.id)
    await confirmLoanPayment(member, row.id, { version: row.version, amount: row.amount, date: f.today, allocation: "principal" })
    expect((await getLoan(member, f.loan.id)).debt).toBeLessThan(100_000_00)
  })

  it("guards linked payments and liability accounts from generic edits", async () => {
    const f = await fixture()
    const row = (await parts(f.loan.id))[0]!
    await expect(confirmTransaction(f.ctx, row.id, { version: row.version })).rejects.toThrow("целиком")
    await expect(deleteTransaction(f.ctx, row.id)).rejects.toThrow("целиком")
    await expect(updateTransaction(f.ctx, row.id, { ...row, version: 1, type: "expense", status: "planned" })).rejects.toThrow("целиком")
    await expect(
      createTransaction(f.ctx, {
        type: "transfer",
        amount: 100,
        accountId: f.mainAccount,
        toAccountId: f.loan.accountId,
        date: f.today,
        status: "posted",
      }),
    ).rejects.toThrow("Кредиты")
    await expect(updateAccount(f.ctx, f.loan.accountId, { name: "Changed", kind: "debit_card", openingBalance: 0 })).rejects.toThrow(
      "Кредиты",
    )
  })

  it("supports starting mid-loan with only payment known and a zero-interest single-part payment", async () => {
    const f = await fixture({ annualRate: "0", termMonths: undefined, paymentAmount: 100_000_00 })
    expect(f.loan.termMonths).toBe(1)
    expect(await parts(f.loan.id)).toHaveLength(1)
    await confirmFirst(f)
    const d = await getLoan(f.ctx, f.loan.id)
    expect(d.debt).toBe(0)
    await closeLoan(f.ctx, f.loan.id, d.loan.version)
    expect((await getLoan(f.ctx, f.loan.id)).loan.status).toBe("closed")
  })

  it("deletes an unused loan, preserves posted history and refuses closing unpaid debt", async () => {
    const f = await fixture()
    await expect(closeLoan(f.ctx, f.loan.id, 1)).rejects.toThrow("долг")
    await deleteLoan(f.ctx, f.loan.id, 1)
    expect(await parts(f.loan.id)).toHaveLength(0)
    expect((await listAccounts(f.ctx)).some((a) => a.id === f.loan.accountId)).toBe(false)
    const g = await fixture()
    await confirmFirst(g)
    await expect(deleteLoan(g.ctx, g.loan.id, 2)).rejects.toThrow("история")
    expect((await parts(g.loan.id)).some((r) => r.status === "posted")).toBe(true)
  })

  it("values foreign-currency liabilities and credit cards in the household base currency", async () => {
    const f = await setupHousehold("FX loans")
    const today = todayIn(f.ctx.timezone)
    await getDb()
      .insert(exchangeRates)
      .values({ currency: "USD", date: today, rateToRub: "100", source: "manual" })
      .onConflictDoUpdate({ target: [exchangeRates.currency, exchangeRates.date, exchangeRates.source], set: { rateToRub: "100" } })
    const usd = await createAccount(f.ctx, { name: "USD payments", kind: "debit_card", currency: "USD", openingBalance: 5000_00 })
    const loan = await createLoan(f.ctx, {
      name: "USD loan",
      lender: "Bank",
      kind: "consumer",
      principal: 2000_00,
      trackingBalance: 1000_00,
      annualRate: "0",
      startDate: addMonths(today, -3),
      trackingDate: today,
      firstPaymentDate: addMonths(today, 1),
      termMonths: 12,
      paymentDay: Number(today.slice(8)),
      scheduleType: "annuity",
      interestMethod: "monthly",
      paymentAccountId: usd.id,
    })
    expect((await listAccounts(f.ctx)).find((a) => a.id === usd.id)!.creditLimit).toBe(0)
    const card = await createAccount(f.ctx, { name: "Card", kind: "credit_card", openingBalance: -10_000_00, creditLimit: 100_000_00 })
    expect(card.creditLimit).toBe(100_000_00)
    await expect(getDb().update(financialAccounts).set({ creditLimit: -1 }).where(eq(financialAccounts.id, card.id))).rejects.toThrow()
    const dashboard = await getDashboard(f.ctx, today)
    expect(dashboard.debt).toBe(110_000_00)
    expect(dashboard.balance).toBe(490_000_00)
    expect(dashboard.netAssets).toBe(390_000_00)
    expect((await getLoan(f.ctx, loan.id)).currency).toBe("USD")
  })

  it("validates event payloads and preserves touched plans before reconciliation", async () => {
    const f = await fixture()
    await expect(
      getDb()
        .insert(loanEvents)
        .values({ householdId: f.ctx.householdId, loanId: f.loan.id, type: "prepayment", date: f.today, mode: "reduce_term" }),
    ).rejects.toThrow()
    const row = (await parts(f.loan.id))[0]!
    await getDb().update(transactions).set({ version: 2 }).where(eq(transactions.id, row.id))
    await expect(addLoanEvent(f.ctx, f.loan.id, 1, { type: "reconciliation", date: f.today, balance: 50_000_00 })).rejects.toThrow(
      "изменённые",
    )
    expect((await parts(f.loan.id)).find((r) => r.id === row.id)!.status).toBe("planned")
  })
})
