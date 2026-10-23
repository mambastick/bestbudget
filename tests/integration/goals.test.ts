import { and, eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { getDb } from "@/db"
import { goalContributions, goals, recurringRules, transactions } from "@/db/schema"
import { addDays, addMonths, startOfMonth, todayIn } from "@/lib/dates"
import { createAccount, listAccounts, updateAccount } from "@/server/services/catalog"
import { saveManualRate } from "@/server/services/exchange-rates"
import {
  automateGoal,
  contributeToGoal,
  createGoal,
  getGoalDetail,
  listGoals,
  setGoalArchived,
  stopGoalAutomation,
  transferToGoal,
  updateGoal,
} from "@/server/services/goals"
import { confirmTransaction, createTransaction, skipTransaction } from "@/server/services/transactions"
import { getCalendarMonth, getDashboard, projection } from "@/server/services/reports"
import { setupHousehold } from "./helpers"

const fixed = { name: "Отпуск", targetAmount: 300_000_00, currency: "RUB" as const, kind: "account" as const }

describe("goals service", () => {
  it("shares one balance without double counting; priority, caps, withdrawals and archive release funds", async () => {
    const { ctx, mainAccount } = await setupHousehold()
    const account = await createAccount(ctx, { name: "Savings", kind: "savings", openingBalance: 100_000_00 })
    const a = await createGoal(ctx, { ...fixed, accountId: account.id, priority: 1, allocatedAmount: 60_000_00 })
    const b = await createGoal(ctx, { ...fixed, accountId: account.id, priority: 2 })
    const read = async () => (await listGoals(ctx)).goals.map((g) => [g.id, g.progress])
    expect(await read()).toEqual([
      [a.id, 60_000_00],
      [b.id, 40_000_00],
    ])
    await createTransaction(ctx, {
      type: "transfer",
      status: "posted",
      date: todayIn(ctx.timezone),
      amount: 70_000_00,
      accountId: account.id,
      toAccountId: mainAccount,
    })
    expect(await read()).toEqual([
      [a.id, 30_000_00],
      [b.id, 0],
    ])
    await setGoalArchived(ctx, a.id, a.version, true)
    expect((await getGoalDetail(ctx, b.id)).goal.progress).toBe(30_000_00)
    await expect(setGoalArchived(ctx, a.id, a.version, false)).rejects.toMatchObject({ code: "conflict" })
    await expect(updateGoal(ctx, b.id, { ...fixed, accountId: account.id, priority: 1, version: b.version + 1 })).rejects.toMatchObject({
      code: "conflict",
    })
    await updateGoal(ctx, b.id, { ...fixed, accountId: account.id, priority: 1, version: b.version })
  })

  it("manual signed contributions preserve comments without changing account balances", async () => {
    const { ctx } = await setupHousehold()
    const member = { ...ctx, role: "member" as const }
    const goal = await createGoal(member, { ...fixed, kind: "manual", targetAmount: 100_00 })
    const today = todayIn(ctx.timezone)
    await contributeToGoal(member, goal.id, { date: today, amount: 120_00, comment: "Подарок" })
    expect((await getGoalDetail(ctx, goal.id)).goal).toMatchObject({ progress: 120_00, percent: 100, status: "achieved" })
    await contributeToGoal(member, goal.id, { date: today, amount: -30_00, comment: "Взяли из копилки" })
    const detail = await getGoalDetail(ctx, goal.id)
    expect(detail.goal).toMatchObject({ progress: 90_00, remaining: 10_00, status: "no_deadline" })
    expect(detail.history.map((h) => h.comment)).toContain("Взяли из копилки")
    expect((await listAccounts(ctx))[0]!.balance).toBe(0)
    await expect(contributeToGoal(ctx, goal.id, { date: addDays(today, 1), amount: 1 })).rejects.toThrow("будущей")
    await setGoalArchived(ctx, goal.id, goal.version, true)
    await expect(contributeToGoal(ctx, goal.id, { date: today, amount: 1 })).rejects.toThrow("архива")
  })

  it("values USD goals from RUB accounts and dynamically computes emergency targets", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const today = todayIn(ctx.timezone)
    await saveManualRate(ctx.userId, { currency: "USD", date: today, rateToRub: "100" })
    const account = await createAccount(ctx, { name: "RUB savings", kind: "savings", openingBalance: 750_000_00 })
    const usd = await createGoal(ctx, { ...fixed, name: "Машина", targetAmount: 15_000_00, currency: "USD", accountId: account.id })
    expect((await getGoalDetail(ctx, usd.id)).goal).toMatchObject({ progress: 7_500_00, percent: 50 })
    await expect(
      updateAccount(ctx, account.id, {
        name: account.name,
        kind: account.kind,
        currency: "USD",
        openingBalance: account.openingBalance,
        version: account.version,
      }),
    ).rejects.toThrow("целями")
    const cushion = await createGoal(ctx, { ...fixed, name: "Подушка", kind: "manual", expenseMonths: 6, expenseWindow: 3 })
    for (const i of [-1, -2, -3])
      await createTransaction(ctx, {
        type: "expense",
        status: "posted",
        accountId: mainAccount,
        categoryId: cat("Продукты"),
        amount: 50_000_00,
        date: addMonths(startOfMonth(today), i),
      })
    expect((await getGoalDetail(ctx, cushion.id)).goal.target).toBe(300_000_00)
    await createTransaction(ctx, {
      type: "expense",
      status: "posted",
      accountId: mainAccount,
      categoryId: cat("Продукты"),
      amount: 30_000_00,
      date: addMonths(startOfMonth(today), -1),
    })
    expect((await getGoalDetail(ctx, cushion.id)).goal.target).toBe(360_000_00)
    const missing = await createGoal(ctx, { ...fixed, currency: "BHD", accountId: account.id, priority: 1 })
    const data = await listGoals(ctx)
    expect(data.goals.find((g) => g.id === missing.id)?.progress).toBeNull()
    expect(data.warnings.length).toBeGreaterThan(0)
  })

  it("reuses recurring transfers, projects them, honors edits/skips, and archives atomically", async () => {
    const { ctx, mainAccount } = await setupHousehold()
    const today = todayIn(ctx.timezone)
    const account = await createAccount(ctx, { name: "Savings", kind: "savings", openingBalance: 0 })
    const goal = await createGoal(ctx, { ...fixed, accountId: account.id, targetDate: addMonths(today, 3) })
    const rule = await automateGoal(ctx, goal.id, { accountId: mainAccount, day: Number(today.slice(8)), version: goal.version })
    const planned = await getDb().select().from(transactions).where(eq(transactions.recurringRuleId, rule.id))
    expect(planned.length).toBeGreaterThan(0)
    expect(planned.every((r) => r.status === "planned" && r.type === "transfer" && r.toAccountId === account.id)).toBe(true)
    const detail = await getGoalDetail(ctx, goal.id)
    expect(detail.goal.status).toBe("on_track")
    expect(detail.goal.plannedDate).toBe(goal.targetDate)
    expect(detail.goal.historicalDate).toBeNull()
    expect(detail.chart.at(-1)!.planned).toBe(goal.targetAmount)
    const dash = await getDashboard(ctx, startOfMonth(today))
    expect(dash.upcoming.some((r) => r.ruleId === rule.id)).toBe(true)
    expect(dash.plannedExpense).toBe(0)
    const calendar = await getCalendarMonth(ctx, today)
    expect(calendar.items.some((r) => r.recurringRuleId === rule.id)).toBe(true)
    const proj = await projection(ctx, today, addMonths(today, 3), today)
    expect(proj.plannedItems.some((r) => r.type === "transfer")).toBe(true)
    expect(proj.days.every((r) => r.balance === 0)).toBe(true)
    await expect(automateGoal(ctx, goal.id, { accountId: mainAccount, day: 1, version: goal.version + 1 })).rejects.toThrow("уже настроено")
    await skipTransaction(ctx, planned[0]!.id, { ...planned[0]! }.version)
    expect((await getGoalDetail(ctx, goal.id)).goal.plannedDate).toBeNull()
    await confirmTransaction(ctx, planned[0]!.id, { version: planned[0]!.version + 1 })
    const progress = (await getGoalDetail(ctx, goal.id)).goal.progress
    expect(progress).toBe(rule.amount)
    await setGoalArchived(ctx, goal.id, goal.version + 1, true)
    expect(await getDb().select().from(recurringRules).where(eq(recurringRules.goalId, goal.id))).toHaveLength(0)
    expect(
      await getDb()
        .select()
        .from(transactions)
        .where(and(eq(transactions.toAccountId, account.id), eq(transactions.status, "planned"))),
    ).toHaveLength(0)
    expect((await listAccounts(ctx)).find((a) => a.id === account.id)?.balance).toBe(progress)
  })

  it("funds senior goals before a shared-account deadline and prevents impossible caps", async () => {
    const { ctx, mainAccount } = await setupHousehold()
    const today = todayIn(ctx.timezone)
    const account = await createAccount(ctx, { name: "Shared savings", kind: "savings", openingBalance: 0 })
    await createGoal(ctx, { ...fixed, targetAmount: 100_000_00, accountId: account.id, priority: 1 })
    const goal = await createGoal(ctx, { ...fixed, accountId: account.id, priority: 2, targetDate: addMonths(today, 3) })
    const rule = await automateGoal(ctx, goal.id, { accountId: mainAccount, day: Number(today.slice(8)), version: goal.version })
    expect(rule.amount).toBe(100_000_00)
    expect((await getGoalDetail(ctx, goal.id)).goal.plannedDate).toBe(goal.targetDate)
    await stopGoalAutomation(ctx, goal.id)
    const version = (await getGoalDetail(ctx, goal.id)).goal.version
    await updateGoal(ctx, goal.id, {
      ...fixed,
      accountId: account.id,
      priority: 2,
      targetDate: goal.targetDate,
      allocatedAmount: 1,
      version,
    })
    await expect(automateGoal(ctx, goal.id, { accountId: mainAccount, day: 1, version: version + 1 })).rejects.toThrow("Лимит")
  })

  it("uses the entire balance for a sole goal and rounds a cross-currency target ceiling up", async () => {
    const { ctx } = await setupHousehold()
    const today = todayIn(ctx.timezone)
    await saveManualRate(ctx.userId, { currency: "USD", date: today, rateToRub: "95" })
    const account = await createAccount(ctx, { name: "Savings", kind: "savings", currency: "USD", openingBalance: 100_00 })
    const sole = await createGoal(ctx, { ...fixed, targetAmount: 1_000_00, accountId: account.id, priority: 1 })
    expect((await getGoalDetail(ctx, sole.id)).goal).toMatchObject({ progress: 9_500_00, status: "achieved" })
    await createGoal(ctx, { ...fixed, accountId: account.id, priority: 2 })
    expect((await getGoalDetail(ctx, sole.id)).goal).toMatchObject({ progress: 100035, status: "achieved" })
  })

  it("supports cross-currency funding and disabling/recreating an automation", async () => {
    const { ctx, mainAccount } = await setupHousehold()
    const today = todayIn(ctx.timezone)
    await saveManualRate(ctx.userId, { currency: "USD", date: today, rateToRub: "100" })
    const account = await createAccount(ctx, { name: "USD", kind: "savings", currency: "USD", openingBalance: 0 })
    const goal = await createGoal(ctx, {
      ...fixed,
      currency: "USD",
      targetAmount: 1_000_00,
      accountId: account.id,
      targetDate: addMonths(today, 2),
    })
    await transferToGoal(ctx, goal.id, { accountId: mainAccount, amount: 10_000_00, toAmount: 100_00, date: today })
    expect((await getGoalDetail(ctx, goal.id)).goal.progress).toBe(100_00)
    const rule = await automateGoal(ctx, goal.id, { accountId: mainAccount, day: 31, version: goal.version })
    expect(rule.amount).toBe(rule.toAmount! * 100)
    await stopGoalAutomation(ctx, goal.id)
    const current = (await getGoalDetail(ctx, goal.id)).goal
    expect(current.automation).toBeNull()
    await automateGoal(ctx, goal.id, { accountId: mainAccount, day: 31, version: current.version })
  })

  it("isolates reads/writes and enforces composite household references", async () => {
    const a = await setupHousehold()
    const b = await setupHousehold()
    const account = await createAccount(a.ctx, { name: "Savings", kind: "savings", openingBalance: 0 })
    const manual = await createGoal(a.ctx, { ...fixed, kind: "manual" })
    expect((await listGoals(b.ctx)).goals).toHaveLength(0)
    await expect(getGoalDetail(b.ctx, manual.id)).rejects.toMatchObject({ code: "not_found" })
    await expect(contributeToGoal(b.ctx, manual.id, { date: todayIn(b.ctx.timezone), amount: 1 })).rejects.toMatchObject({
      code: "not_found",
    })
    await expect(createGoal(b.ctx, { ...fixed, accountId: account.id })).rejects.toMatchObject({ code: "not_found" })
    await expect(
      getDb()
        .insert(goals)
        .values({ ...fixed, householdId: b.ctx.householdId, accountId: account.id }),
    ).rejects.toThrow()
    await expect(
      getDb()
        .insert(goalContributions)
        .values({ householdId: b.ctx.householdId, goalId: manual.id, date: todayIn(b.ctx.timezone), amount: 1 }),
    ).rejects.toThrow()
    await expect(updateGoal(b.ctx, manual.id, { ...fixed, kind: "manual", version: 1 })).rejects.toMatchObject({ code: "not_found" })
  })
})
