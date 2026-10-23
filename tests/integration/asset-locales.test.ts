import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { getDb } from "@/db"
import { recurringRules, transactions, users } from "@/db/schema"
import { addMonths, todayIn } from "@/lib/dates"
import { createAccount } from "@/server/services/catalog"
import { automateGoal, createGoal, getGoalDetail, listGoals, transferToGoal } from "@/server/services/goals"
import { createLoan, ensureLoansMaterialized, virtualLoanPayments } from "@/server/services/loans"
import { setupHousehold } from "./helpers"

describe("asset service locales", () => {
  it("uses the acting user's language for new titles and the creator's saved language for background loan plans", async () => {
    const { ctx, mainAccount } = await setupHousehold()
    const today = todayIn(ctx.timezone)
    const loan = await createLoan({ ...ctx, locale: "en" }, {
      name: "Семейная ипотека", lender: "Банк", kind: "mortgage", principal: 100_000_00, trackingBalance: 100_000_00,
      annualRate: "12", startDate: today, trackingDate: today, firstPaymentDate: addMonths(today, 1), termMonths: 12,
      paymentDay: Number(today.slice(8)), scheduleType: "annuity", interestMethod: "monthly", paymentAccountId: mainAccount,
    })
    const db = getDb()
    const key = and(eq(transactions.householdId, ctx.householdId), eq(transactions.loanId, loan.id))
    const initial = await db.select().from(transactions).where(key)
    expect(initial.length).toBeGreaterThan(0)
    expect(initial.every((r) => r.title === "Loan payment")).toBe(true)
    await db.update(users).set({ locale: "ru" }).where(eq(users.id, ctx.userId))
    await ensureLoansMaterialized(ctx, addMonths(today, 3))
    const later = await db.select().from(transactions).where(key)
    expect(later.some((r) => r.title === "Платёж по кредиту")).toBe(true)
    expect(later.filter((r) => initial.some((old) => old.id === r.id)).every((r) => r.title === "Loan payment")).toBe(true)
    const virtual = await virtualLoanPayments({ ...ctx, locale: "en" }, addMonths(today, 6), addMonths(today, 12))
    expect(virtual.length).toBeGreaterThan(0)
    expect(virtual.every((r) => r.title === "Loan payment: Семейная ипотека")).toBe(true)
  })

  it("localises goal transfers, schedules and generated history while preserving saved names", async () => {
    const { ctx: base, mainAccount } = await setupHousehold()
    const ctx = { ...base, locale: "en" }
    const today = todayIn(ctx.timezone)
    const account = await createAccount(ctx, { name: "Копилка", kind: "savings", openingBalance: 0 })
    const goal = await createGoal(ctx, { name: "Отпуск", kind: "account", accountId: account.id, currency: "RUB", targetAmount: 100_000_00, targetDate: addMonths(today, 6) })
    await transferToGoal(ctx, goal.id, { accountId: mainAccount, amount: 100_00, date: today })
    await automateGoal(ctx, goal.id, { accountId: mainAccount, day: 5, version: goal.version })
    const [transfer] = await getDb().select().from(transactions).where(eq(transactions.householdId, ctx.householdId))
    const [rule] = await getDb().select().from(recurringRules).where(eq(recurringRules.goalId, goal.id))
    expect(transfer?.title).toBe("Towards goal: Отпуск")
    expect(rule?.title).toBe("Towards goal: Отпуск")
    const en = await getGoalDetail(ctx, goal.id)
    const ru = await getGoalDetail(base, goal.id)
    expect(en.goal.name).toBe("Отпуск")
    expect(en.history[0]?.comment).toBe("Change in allocated account balance")
    expect(ru.history[0]?.comment).toBe("Изменение распределённого остатка счёта")
  })

  it("returns incomplete progress warnings in the reader's language", async () => {
    const { ctx } = await setupHousehold()
    const account = await createAccount(ctx, { name: "Копилка", kind: "savings", openingBalance: 100_00 })
    await createGoal(ctx, { name: "Путешествие", kind: "account", accountId: account.id, currency: "BHD", targetAmount: 100_000 })
    const en = await listGoals({ ...ctx, locale: "en" })
    expect(en.warnings).toContain("Missing BHD exchange rate. Goal progress and projections are incomplete.")
    expect(en.goals[0]?.progress).toBeNull()
    const ru = await listGoals(ctx)
    expect(ru.warnings).toContain("Нет курса BHD. Прогресс и прогноз цели неполные.")
    expect(ru.goals[0]?.name).toBe("Путешествие")
  })
})
