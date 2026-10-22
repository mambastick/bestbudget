import "server-only"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { financialAccounts, transactions } from "@/db/schema"
import { addDays, todayIn } from "@/lib/dates"
import type { HouseholdCtx } from "../context"
import { createConverter, loadRates } from "./exchange-rates"

/**
 * Opening balances, current account valuations and projections need the same complete household ledger.
 * For a family-sized history we deliberately aggregate it once in SQL instead of maintaining mutable rollups.
 * Grouping bounds the data transferred; query count is independent of operation count. The existing
 * transactions_household_status_date_idx (household_id, status, date), created in 0000, scopes this scan.
 */
export async function loadFinance(ctx: HouseholdCtx, valuationDates: string[] = []) {
  const db = getDb()
  const today = todayIn(ctx.timezone)
  const [accounts, grouped] = await Promise.all([
    db.select().from(financialAccounts).where(eq(financialAccounts.householdId, ctx.householdId)),
    db.select({
      accountId: transactions.accountId,
      toAccountId: transactions.toAccountId,
      categoryId: transactions.categoryId,
      date: transactions.date,
      type: transactions.type,
      status: transactions.status,
      amount: sql<string>`sum(${transactions.amount})`,
      toAmount: sql<string>`sum(coalesce(${transactions.toAmount}, ${transactions.amount}))`,
      count: sql<number>`count(*)::int`,
    }).from(transactions).where(and(eq(transactions.householdId, ctx.householdId), sql`${transactions.status} <> 'skipped'`))
      .groupBy(transactions.accountId, transactions.toAccountId, transactions.categoryId, transactions.date, transactions.type, transactions.status),
  ])
  const accountMap = new Map(accounts.map((a) => [a.id, a]))
  const rows = grouped.map((r) => ({ ...r, amount: Number(r.amount), toAmount: Number(r.toAmount), currency: accountMap.get(r.accountId)!.currency }))
  const dates = [...new Set([today, ...valuationDates])]
  const needs = [
    ...accounts.flatMap((a) => dates.map((date) => ({ currency: a.currency, date }))),
    ...rows.filter((r) => r.status === "posted").flatMap((r) => [
      { currency: r.currency, date: r.date > today ? today : r.date },
      { currency: ctx.currency, date: r.date > today ? today : r.date },
      ...(r.toAccountId ? [{ currency: accountMap.get(r.toAccountId)!.currency, date: r.date > today ? today : r.date }] : []),
    ]),
    ...dates.map((date) => ({ currency: ctx.currency, date })),
  ]
  const rates = await loadRates(accounts.some((a) => a.currency !== ctx.currency) ? needs : [])
  const fx = createConverter(rates, ctx.currency)
  const convert = (amount: number, currency: string, date = today) => fx.convert(amount, currency, date > today ? today : date)
  const value = (r: { amount: number; accountId: string; date: string; status?: string }) =>
    convert(r.amount, accountMap.get(r.accountId)!.currency, r.status === "posted" ? r.date : today)
  const balances = new Map(accounts.map((a) => [a.id, a.openingBalance]))
  for (const r of rows.filter((r) => r.status === "posted")) applyMovement(balances, r)
  const balance = accounts.reduce((sum, a) => sum + convert(balances.get(a.id)!, a.currency), 0)
  return { today, accounts, accountMap, rows, rates, fx, convert, value, balance }
}

/** Daily historical valuations also need rates on days without any operations. */
export function pastValuationDates(from: string, to: string, today: string): string[] {
  const dates = []
  for (let date = from; date <= to && date < today; date = addDays(date, 1)) dates.push(date)
  return dates
}

export type FinanceData = Awaited<ReturnType<typeof loadFinance>>
export type Movement = { type: string; accountId: string; toAccountId: string | null; amount: number; toAmount: number | null }

export function applyMovement(balances: Map<string, number>, row: Movement) {
  const delta = row.type === "income" ? row.amount : -row.amount
  balances.set(row.accountId, (balances.get(row.accountId) ?? 0) + delta)
  if (row.type === "transfer" && row.toAccountId) balances.set(row.toAccountId, (balances.get(row.toAccountId) ?? 0) + (row.toAmount ?? row.amount))
}
