import { and, eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { closeDb, getDb } from "@/db"
import { transactions } from "@/db/schema"
import { createAccount, listAccounts } from "@/server/services/catalog"
import { createRules, ensureMaterialized, listRules, materializeOccurrence, stopRule, updateRule, virtualOccurrences } from "@/server/services/recurring"
import { actualBalance, getAnalytics, getCalendarMonth, getDashboard } from "@/server/services/reports"
import {
  confirmTransaction,
  createTransaction,
  deleteTransaction,
  listTransactions,
  skipTransaction,
  updateTransaction,
} from "@/server/services/transactions"
import { setupHousehold } from "./helpers"

// Fixed "today" in Europe/Moscow: 2026-11-01.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-01T09:00:00Z") })
})
afterAll(async () => {
  vi.useRealTimers()
  await closeDb()
})

const rub = (n: number) => n * 100

async function ruleRows(ruleId: string) {
  return getDb().select().from(transactions).where(eq(transactions.recurringRuleId, ruleId)).orderBy(transactions.occurrenceDate)
}

describe("one-off income and expense", () => {
  it("updates the actual balance only for posted operations", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    await createTransaction(ctx, { type: "income", amount: rub(150_000), categoryId: cat("Премия"), accountId: mainAccount, date: "2026-11-01", status: "posted" })
    await createTransaction(ctx, { type: "expense", amount: rub(60_000), categoryId: cat("Здоровье"), accountId: mainAccount, date: "2026-11-01", status: "posted" })
    await createTransaction(ctx, { type: "expense", amount: rub(1_000), categoryId: cat("Прочее"), accountId: mainAccount, date: "2026-11-20", status: "planned" })
    expect(await actualBalance(ctx)).toBe(rub(90_000))

    const dash = await getDashboard(ctx, "2026-11-01")
    expect(dash.monthIncome).toBe(rub(150_000))
    expect(dash.monthExpense).toBe(rub(60_000))
    expect(dash.plannedExpense).toBe(rub(1_000))
    expect(dash.forecastEndOfMonth).toBe(rub(89_000))
    expect(dash.availableAfterObligations).toBe(rub(89_000))
  })

  it("defaults the title to the category name and validates category kind", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const t = await createTransaction(ctx, { type: "expense", amount: 100, categoryId: cat("Продукты"), accountId: mainAccount, date: "2026-11-01", status: "posted" })
    expect(t.title).toBe("Продукты")
    await expect(
      createTransaction(ctx, { type: "expense", amount: 100, categoryId: cat("Зарплата"), accountId: mainAccount, date: "2026-11-01", status: "posted" }),
    ).rejects.toThrow(/не соответствует/)
  })

  it("rejects stale edits (optimistic concurrency)", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const t = await createTransaction(ctx, { type: "expense", amount: 100, categoryId: cat("Продукты"), accountId: mainAccount, date: "2026-11-01", status: "posted" })
    const input = { type: "expense" as const, amount: 200, categoryId: cat("Продукты"), accountId: mainAccount, date: "2026-11-01", status: "posted" as const }
    await updateTransaction(ctx, t.id, { ...input, version: t.version })
    await expect(updateTransaction(ctx, t.id, { ...input, amount: 300, version: t.version })).rejects.toThrow(/изменены другим участником/)
  })

  it("searches and filters operations", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    await createTransaction(ctx, { type: "expense", amount: 100, title: "Ремонт автомобиля", categoryId: cat("Автомобиль"), accountId: mainAccount, date: "2026-10-10", status: "posted" })
    await createTransaction(ctx, { type: "expense", amount: 100, title: "Телефон", categoryId: cat("Прочее"), accountId: mainAccount, date: "2026-11-01", status: "posted" })
    expect((await listTransactions(ctx, { q: "ремонт" })).rows.map((r) => r.title)).toEqual(["Ремонт автомобиля"])
    expect((await listTransactions(ctx, { from: "2026-11-01" })).rows).toHaveLength(1)
    expect((await listTransactions(ctx, { categoryId: cat("Автомобиль") })).rows).toHaveLength(1)
  })
})

describe("recurring operations", () => {
  it("creates salary with two accruals per month as planned, not actual", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    await createRules(ctx, {
      rule: { type: "income", title: "Зарплата", amount: rub(238_000), categoryId: cat("Зарплата"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 5, startDate: "2026-11-01" },
      extra: [{ dayOfMonth: 20, amount: rub(128_000) }],
    })
    const rules = await listRules(ctx)
    expect(rules).toHaveLength(2)
    expect(await actualBalance(ctx)).toBe(0)

    const dash = await getDashboard(ctx, "2026-11-01")
    expect(dash.plannedIncome).toBe(rub(366_000))
    expect(dash.forecastEndOfMonth).toBe(rub(366_000))
    expect(dash.balance).toBe(0)
    expect(dash.upcoming.map((u) => [u.date, u.amount])).toEqual([
      ["2026-11-05", rub(238_000)],
      ["2026-11-20", rub(128_000)],
    ])
  })

  it("is idempotent: repeated generation creates no duplicates", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const [rule] = await createRules(ctx, {
      rule: { type: "expense", title: "Кредит", amount: rub(43_000), categoryId: cat("Кредиты"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 7, startDate: "2026-11-01" },
    })
    const before = (await ruleRows(rule!.id)).length
    expect(before).toBeGreaterThan(0)
    await ensureMaterialized(ctx.householdId, "2026-11-01")
    await Promise.all([ensureMaterialized(ctx.householdId, "2026-11-01"), ensureMaterialized(ctx.householdId, "2026-11-01")])
    expect((await ruleRows(rule!.id)).length).toBe(before)
    // Moving the horizon forward adds only the new occurrences.
    await ensureMaterialized(ctx.householdId, "2026-12-15")
    const after = await ruleRows(rule!.id)
    expect(new Set(after.map((r) => r.occurrenceDate)).size).toBe(after.length)
  })

  it("stops temporary income after its end date and projects it into future months", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    await createRules(ctx, {
      rule: { type: "income", title: "Подработка", amount: rub(30_000), categoryId: cat("Подработка"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 10, startDate: "2026-11-01", endDate: "2027-04-30" },
    })
    const virtual = await virtualOccurrences(ctx, "2026-11-01", "2027-12-31", "2026-11-01")
    const all = [...(await listTransactions(ctx, {})).rows.map((r) => r.date), ...virtual.map((v) => v.date)].sort()
    expect(all).toEqual(["2026-11-10", "2026-12-10", "2027-01-10", "2027-02-10", "2027-03-10", "2027-04-10"])

    // Forecast for a month beyond the materialization horizon uses virtual occurrences.
    const march = await getDashboard(ctx, "2027-03-01")
    expect(march.plannedIncome).toBe(rub(30_000))
    expect(march.forecastEndOfMonth).toBe(rub(150_000))
    const may = await getDashboard(ctx, "2027-05-01")
    expect(may.plannedIncome).toBe(0)
    expect(may.forecastEndOfMonth).toBe(rub(180_000))
  })

  it("handles the 31st in short months", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    await createRules(ctx, {
      rule: { type: "expense", title: "Аренда", amount: rub(50_000), categoryId: cat("Аренда"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 31, startDate: "2026-11-01" },
    })
    const feb = await getCalendarMonth(ctx, "2027-02-01")
    expect(feb.items.map((i) => i.date)).toEqual(["2027-02-28"])
    const nov = await getCalendarMonth(ctx, "2026-11-01")
    expect(nov.items.map((i) => i.date)).toEqual(["2026-11-30"])
  })

  it("confirming with a different amount changes the actual balance", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const [rule] = await createRules(ctx, {
      rule: { type: "income", title: "Зарплата", amount: rub(200_000), categoryId: cat("Зарплата"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 5, startDate: "2026-11-01" },
    })
    const [first] = await ruleRows(rule!.id)
    await confirmTransaction(ctx, first!.id, { version: first!.version, amount: rub(205_000), date: "2026-11-04" })
    expect(await actualBalance(ctx)).toBe(rub(205_000))
    const [after] = await ruleRows(rule!.id)
    expect(after!.status).toBe("posted")
    expect(after!.occurrenceDate).toBe("2026-11-05")
    // Regeneration keeps the confirmed slot.
    await ensureMaterialized(ctx.householdId, "2026-11-01")
    expect((await ruleRows(rule!.id)).filter((r) => r.occurrenceDate === "2026-11-05")).toHaveLength(1)
  })

  it("skips, reschedules and deletes single occurrences without regenerating them", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const [rule] = await createRules(ctx, {
      rule: { type: "expense", title: "Подписки", amount: rub(5_000), categoryId: cat("Подписки"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 14, startDate: "2026-11-01" },
    })
    const [nov, dec] = await ruleRows(rule!.id)
    await skipTransaction(ctx, nov!.id, nov!.version)
    await updateTransaction(ctx, dec!.id, {
      type: "expense",
      amount: rub(5_500),
      title: "Подписки",
      categoryId: cat("Подписки"),
      accountId: mainAccount,
      date: "2026-12-16",
      status: "planned",
      version: dec!.version,
    })
    await ensureMaterialized(ctx.householdId, "2026-11-01")
    const rows = await ruleRows(rule!.id)
    expect(rows.filter((r) => r.occurrenceDate === "2026-11-14").map((r) => r.status)).toEqual(["skipped"])
    expect(rows.find((r) => r.occurrenceDate === "2026-12-14")).toMatchObject({ date: "2026-12-16", amount: rub(5_500) })

    // Deleting an occurrence marks it skipped so the slot is not recreated.
    const jan = rows.find((r) => r.occurrenceDate === "2027-01-14")
    if (jan) {
      expect(await deleteTransaction(ctx, jan.id)).toEqual({ skipped: true })
      await ensureMaterialized(ctx.householdId, "2026-11-01")
      expect((await ruleRows(rule!.id)).filter((r) => r.occurrenceDate === "2027-01-14")).toHaveLength(1)
    }
  })

  it("changes all future occurrences while keeping confirmed history", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const [rule] = await createRules(ctx, {
      rule: { type: "expense", title: "ЖКХ", amount: rub(8_000), categoryId: cat("ЖКХ"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 10, startDate: "2026-11-01" },
    })
    const [nov] = await ruleRows(rule!.id)
    await confirmTransaction(ctx, nov!.id, { version: nov!.version })
    const current = (await listRules(ctx))[0]!.rule
    await updateRule(ctx, rule!.id, {
      rule: { type: "expense", title: "ЖКХ", amount: rub(9_000), categoryId: cat("ЖКХ"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 12, startDate: "2026-11-01" },
      version: current.version,
      effectiveFrom: "2026-12-01",
    })
    const rows = await ruleRows(rule!.id)
    expect(rows[0]).toMatchObject({ occurrenceDate: "2026-11-10", amount: rub(8_000), status: "posted" })
    expect(rows.slice(1).every((r) => r.amount === rub(9_000) && r.date.endsWith("-12"))).toBe(true)
    // Stale version is rejected.
    await expect(
      updateRule(ctx, rule!.id, {
        rule: { type: "expense", title: "ЖКХ", amount: 1, categoryId: cat("ЖКХ"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 12, startDate: "2026-11-01" },
        version: current.version,
      }),
    ).rejects.toThrow(/изменены/)
  })

  it("stopping a rule removes pending occurrences after the end date", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const [rule] = await createRules(ctx, {
      rule: { type: "expense", title: "Продукты", amount: rub(7_000), categoryId: cat("Продукты"), accountId: mainAccount, frequency: "weekly", startDate: "2026-11-02" },
    })
    await stopRule(ctx, rule!.id, "2026-11-15")
    const rows = await ruleRows(rule!.id)
    expect(rows.map((r) => r.occurrenceDate)).toEqual(["2026-11-02", "2026-11-09"])
    expect(await virtualOccurrences(ctx, "2026-11-01", "2027-06-30", "2026-11-01")).toHaveLength(0)
  })

  it("materializes a far-future virtual occurrence on demand without duplicates", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const [rule] = await createRules(ctx, {
      rule: { type: "expense", title: "Ипотека", amount: rub(60_000), categoryId: cat("Ипотека"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 15, startDate: "2026-11-01" },
    })
    const id = await materializeOccurrence(ctx, rule!.id, "2027-06-15")
    expect(await materializeOccurrence(ctx, rule!.id, "2027-06-15")).toBe(id)
    const virtual = await virtualOccurrences(ctx, "2027-06-01", "2027-06-30", "2026-11-01")
    expect(virtual).toHaveLength(0)
    const june = await getCalendarMonth(ctx, "2027-06-01")
    expect(june.items).toHaveLength(1)
    await expect(materializeOccurrence(ctx, rule!.id, "2027-06-16")).rejects.toThrow()
  })
})

describe("cash gaps and forecast", () => {
  it("marks days with a negative projected balance", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    await createTransaction(ctx, { type: "income", amount: rub(30_000), categoryId: cat("Зарплата"), accountId: mainAccount, date: "2026-11-01", status: "posted" })
    await createRules(ctx, {
      rule: { type: "expense", title: "Кредит", amount: rub(43_000), categoryId: cat("Кредиты"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 7, startDate: "2026-11-01" },
    })
    await createRules(ctx, {
      rule: { type: "income", title: "Зарплата", amount: rub(128_000), categoryId: cat("Зарплата"), accountId: mainAccount, frequency: "monthly", dayOfMonth: 20, startDate: "2026-11-01" },
    })
    const cal = await getCalendarMonth(ctx, "2026-11-01")
    const negative = cal.days.filter((d) => d.balance < 0).map((d) => d.date)
    expect(negative[0]).toBe("2026-11-07")
    expect(negative.at(-1)).toBe("2026-11-19")
    expect(cal.days.at(-1)!.balance).toBe(rub(115_000))
  })
})

describe("accounts and transfers", () => {
  it("does not count transfers as income or expense and keeps totals intact", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const savings = await createAccount(ctx, { name: "Накопительный", kind: "savings", openingBalance: rub(10_000) })
    await createTransaction(ctx, { type: "income", amount: rub(100_000), categoryId: cat("Зарплата"), accountId: mainAccount, date: "2026-11-01", status: "posted" })
    await createTransaction(ctx, { type: "transfer", amount: rub(40_000), accountId: mainAccount, toAccountId: savings.id, date: "2026-11-01", status: "posted" })

    const accounts = await listAccounts(ctx)
    expect(accounts.find((a) => a.id === mainAccount)!.balance).toBe(rub(60_000))
    expect(accounts.find((a) => a.id === savings.id)!.balance).toBe(rub(50_000))
    expect(await actualBalance(ctx)).toBe(rub(110_000))

    const dash = await getDashboard(ctx, "2026-11-01")
    expect(dash.monthIncome).toBe(rub(100_000))
    expect(dash.monthExpense).toBe(0)
    const analytics = await getAnalytics(ctx, "2026-11-01", "2026-11-30")
    expect(analytics.current).toMatchObject({ income: rub(100_000), expense: 0 })
  })

  it("credit card: purchases are expenses once, repayments are transfers", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const card = await createAccount(ctx, { name: "Кредитка", kind: "credit_card", openingBalance: 0 })
    await createTransaction(ctx, { type: "income", amount: rub(50_000), categoryId: cat("Зарплата"), accountId: mainAccount, date: "2026-11-01", status: "posted" })
    await createTransaction(ctx, { type: "expense", amount: rub(12_000), categoryId: cat("Продукты"), accountId: card.id, date: "2026-11-01", status: "posted" })
    await createTransaction(ctx, { type: "transfer", amount: rub(12_000), accountId: mainAccount, toAccountId: card.id, date: "2026-11-01", status: "posted" })

    const accounts = await listAccounts(ctx)
    expect(accounts.find((a) => a.id === card.id)!.balance).toBe(0)
    expect(accounts.find((a) => a.id === mainAccount)!.balance).toBe(rub(38_000))
    const dash = await getDashboard(ctx, "2026-11-01")
    expect(dash.monthExpense).toBe(rub(12_000))
    expect(await actualBalance(ctx)).toBe(rub(38_000))
  })

  it("rejects transfers to the same account", async () => {
    const { ctx, mainAccount } = await setupHousehold()
    await expect(
      createTransaction(ctx, { type: "transfer", amount: 100, accountId: mainAccount, toAccountId: mainAccount, date: "2026-11-01", status: "posted" }),
    ).rejects.toThrow(/различаться/)
  })
})

describe("analytics", () => {
  it("compares with the previous period and lists top categories", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const add = (date: string, amount: number, category: string) =>
      createTransaction(ctx, { type: "expense", amount, categoryId: cat(category), accountId: mainAccount, date, status: "posted" })
    await add("2026-09-10", rub(10_000), "Продукты")
    await add("2026-10-10", rub(15_000), "Продукты")
    await add("2026-10-12", rub(5_000), "Транспорт")
    // Planned operations never count as actuals.
    await createTransaction(ctx, { type: "expense", amount: rub(99_000), categoryId: cat("Прочее"), accountId: mainAccount, date: "2026-10-20", status: "planned" })

    const a = await getAnalytics(ctx, "2026-10-01", "2026-10-31")
    expect(a.current.expense).toBe(rub(20_000))
    expect(a.previous.expense).toBe(rub(10_000))
    expect(a.expenseChange).toBe(100)
    expect(a.categories.map((c) => c.name)).toEqual(["Продукты", "Транспорт"])
  })
})

describe("data integrity", () => {
  it("database rejects floating/negative amounts and cross-household references", async () => {
    const a = await setupHousehold()
    const b = await setupHousehold()
    const base = { householdId: a.ctx.householdId, type: "expense" as const, status: "posted" as const, title: "x", date: "2026-11-01" }
    await expect(getDb().insert(transactions).values({ ...base, amount: -1, categoryId: a.cat("Прочее"), accountId: a.mainAccount })).rejects.toThrow()
    // Category of household B used in household A: blocked by the composite foreign key.
    await expect(getDb().insert(transactions).values({ ...base, amount: 1, categoryId: b.cat("Прочее"), accountId: a.mainAccount })).rejects.toThrow()
    const rows = await getDb().select().from(transactions).where(and(eq(transactions.householdId, a.ctx.householdId)))
    expect(rows).toHaveLength(0)
  })
})
