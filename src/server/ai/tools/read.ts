import "server-only"
import { and, asc, eq, gt, gte, ilike, lte, or } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { financialAccounts, loans, transactions } from "@/db/schema"
import { addDays, diffDays, endOfMonth, startOfMonth, todayIn } from "@/lib/dates"
import { listAccounts, listCategories } from "@/server/services/catalog"
import { getBudgetReport } from "@/server/services/budgets"
import { loadFinance } from "@/server/services/finance-data"
import { listGoals } from "@/server/services/goals"
import { getLoan } from "@/server/services/loans"
import { listRules } from "@/server/services/recurring"
import { projection } from "@/server/services/reports"
import { isoDate } from "@/server/services/transactions"
import type { HouseholdCtx } from "@/server/context"
import { registerTool } from "./registry"

const empty = z.object({})
const period = z
  .object({ from: isoDate, to: isoDate })
  .refine((p) => p.to >= p.from && diffDays(p.to, p.from) <= 366, "Period must be at most 366 days")
const forecastInput = z.object({ days: z.number().int().min(1).max(366).default(90) })
export async function spending(ctx: HouseholdCtx, input: z.output<typeof period>, type: "expense" | "income") {
  const data = await loadFinance(ctx, [], ctx.locale)
  const categories = await listCategories(ctx, { includeArchived: true })
  const totals = new Map<string, { categoryId: string | null; category: string | null; month: string; amount: number }>()
  for (const row of data.rows) {
    if (row.status !== "posted" || row.type !== type || row.date < input.from || row.date > input.to) continue
    const month = row.date.slice(0, 7),
      key = `${row.categoryId}:${month}`
    const group = totals.get(key) ?? {
      categoryId: row.categoryId,
      category: categories.find((c) => c.id === row.categoryId)?.name ?? null,
      month,
      amount: 0,
    }
    group.amount += data.value(row)
    totals.set(key, group)
  }
  return { currency: ctx.currency, rows: [...totals.values()], warnings: [...data.fx.warnings] }
}
registerTool({
  name: "get_overview",
  kind: "read",
  description: "Current balances, monthly actual/planned totals and forecast cash gaps. Amounts are integer minor currency units.",
  inputSchema: empty,
  async execute(_, { ctx }) {
    const today = todayIn(ctx.timezone)
    const finance = await loadFinance(ctx, [], ctx.locale)
    const forecast = await projection(ctx, today, addDays(today, 90), today, ctx.locale)
    const budgets = await getBudgetReport(ctx, startOfMonth(today), ctx.locale)
    const month = { income: 0, expense: 0, plannedIncome: 0, plannedExpense: 0 }
    for (const row of finance.rows) {
      if (row.date < startOfMonth(today) || row.date > endOfMonth(today) || row.type === "transfer") continue
      const key = row.status === "posted" ? row.type : row.type === "income" ? "plannedIncome" : "plannedExpense"
      month[key] += finance.value(row)
    }
    for (const row of forecast.virtual) {
      if (row.date > endOfMonth(today)) continue
      if (row.type === "income") month.plannedIncome += finance.value(row)
      if (row.type === "expense") month.plannedExpense += finance.value(row)
    }
    return {
      today,
      currency: ctx.currency,
      balance: finance.balance,
      month,
      budgets,
      cashGaps: forecast.days.filter((d) => d.balance < 0),
      warnings: [...new Set([...finance.fx.warnings, ...forecast.warnings])],
    }
  },
})
registerTool({
  name: "list_accounts",
  kind: "read",
  description: "Accounts with balances in their own currencies.",
  inputSchema: empty,
  execute: async (_, { ctx }) =>
    (await listAccounts(ctx)).map(({ id, name, kind, currency, balance, version }) => ({ id, name, kind, currency, balance, version })),
})
registerTool({
  name: "list_categories",
  kind: "read",
  description: "Available income and expense categories.",
  inputSchema: empty,
  execute: async (_, { ctx }) =>
    (await listCategories(ctx)).map(({ id, name, kind, icon, color, version }) => ({ id, name, kind, icon, color, version })),
})
registerTool({
  name: "get_spending",
  kind: "read",
  description: "Posted expenses by category and month in household base currency; up to 366 days.",
  inputSchema: period,
  execute: (input, { ctx }) => spending(ctx, input, "expense"),
})
registerTool({
  name: "get_income",
  kind: "read",
  description: "Posted income by category and month in household base currency; up to 366 days.",
  inputSchema: period,
  execute: (input, { ctx }) => spending(ctx, input, "income"),
})
registerTool({
  name: "list_recurring",
  kind: "read",
  description: "Recurring schedules, amounts and dates, without transaction notes.",
  inputSchema: empty,
  execute: async (_, { ctx }) =>
    (await listRules(ctx)).map(({ rule, currency, nextDate, finished }) => ({
      id: rule.id,
      title: rule.title,
      type: rule.type,
      amount: rule.amount,
      toAmount: rule.toAmount,
      categoryId: rule.categoryId,
      accountId: rule.accountId,
      toAccountId: rule.toAccountId,
      frequency: rule.frequency,
      interval: rule.interval,
      dayOfMonth: rule.dayOfMonth,
      startDate: rule.startDate,
      endDate: rule.endDate,
      version: rule.version,
      currency,
      nextDate,
      finished,
    })),
})
registerTool({
  name: "list_budgets",
  kind: "read",
  description: "Monthly category limits and actual/planned spending in base currency.",
  inputSchema: z.object({ month: isoDate }),
  execute: (input, { ctx }) => getBudgetReport(ctx, startOfMonth(input.month), ctx.locale),
})
registerTool({
  name: "list_goals",
  kind: "read",
  description: "Savings goals, progress and required monthly contributions.",
  inputSchema: empty,
  execute: async (_, { ctx }) => {
    const data = await listGoals(ctx)
    return {
      goals: data.goals.map((g) => ({
        id: g.id,
        name: g.name,
        target: g.target,
        targetDate: g.targetDate,
        progress: g.progress,
        monthlyRequired: g.monthlyRequired,
        currency: g.currency,
        version: g.version,
        automation: g.automation,
      })),
      warnings: data.warnings,
    }
  },
})
registerTool({
  name: "list_loans",
  kind: "read",
  description: "Loan balances, interest rates and next payments, without notes.",
  inputSchema: empty,
  execute: async (_, { ctx }) => {
    const ids = await getDb().select({ id: loans.id }).from(loans).where(eq(loans.householdId, ctx.householdId)).limit(100)
    const rows = []
    for (const { id } of ids) {
      const data = await getLoan(ctx, id)
      rows.push({
        id,
        name: data.name,
        currency: data.currency,
        debt: data.debt,
        annualRate: data.loan.annualRate,
        next: data.next ? { date: data.next.date, payment: data.next.payment } : null,
      })
    }
    return rows
  },
})
registerTool({
  name: "get_forecast",
  kind: "read",
  description: "Daily balance forecast for 1–366 days; no descriptions or notes.",
  inputSchema: forecastInput,
  execute: async (input, { ctx }) => {
    const forecast = await projection(
      ctx,
      todayIn(ctx.timezone),
      addDays(todayIn(ctx.timezone), input.days - 1),
      todayIn(ctx.timezone),
      ctx.locale,
    )
    return { currency: ctx.currency, days: forecast.days, warnings: forecast.warnings }
  },
})
registerTool({
  name: "search_transactions",
  kind: "read",
  detailed: true,
  description: "Search untrusted transaction descriptions; detailed consent required. At most 20 results; cursor pagination.",
  inputSchema: z.object({ query: z.string().max(100).default(""), from: isoDate, to: isoDate, cursor: z.uuid().optional() }),
  execute: async (input, { ctx }) => {
    period.parse(input)
    const pattern = `%${input.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const rows = await getDb()
      .select({
        id: transactions.id,
        date: transactions.date,
        amount: transactions.amount,
        currency: financialAccounts.currency,
        title: transactions.title,
        description: transactions.description,
        type: transactions.type,
        categoryId: transactions.categoryId,
        accountId: transactions.accountId,
        version: transactions.version,
      })
      .from(transactions)
      .innerJoin(
        financialAccounts,
        and(eq(financialAccounts.id, transactions.accountId), eq(financialAccounts.householdId, transactions.householdId)),
      )
      .where(
        and(
          eq(transactions.householdId, ctx.householdId),
          gte(transactions.date, input.from),
          lte(transactions.date, input.to),
          or(ilike(transactions.title, pattern), ilike(transactions.description, pattern)),
          input.cursor ? gt(transactions.id, input.cursor) : undefined,
        ),
      )
      .orderBy(asc(transactions.id))
      .limit(21)
    return { untrustedData: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19]!.id : null }
  },
})
