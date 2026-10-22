import "server-only"
import { and, asc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb, type DbOrTx } from "@/db"
import { categories, financialAccounts, recurringRules, transactions, type RecurringRule } from "@/db/schema"
import { occurrencesBetween } from "@/domain/recurrence"
import { addDays, maxDate, minDate, todayIn, type IsoDate } from "@/lib/dates"
import { audit, diff } from "../audit"
import { assertCan, type HouseholdCtx } from "../context"
import { AppError, conflict, notFound } from "../errors"
import { amount, isoDate, normalizeOperation, operationFields } from "./transactions"

/** Planned transactions are materialized this many days ahead; later dates are projected virtually. */
export const MATERIALIZE_DAYS = 62

const scheduleFields = z.object({
  frequency: z.enum(["once", "daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(366).default(1),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
})

export const ruleInput = operationFields.extend(scheduleFields.shape).refine((r) => !r.endDate || r.endDate >= r.startDate, {
  message: "Дата окончания раньше даты начала",
  path: ["endDate"],
})
export type RuleInput = z.input<typeof ruleInput>

/** Several accruals of the same operation, e.g. salary on the 5th and the 20th with different amounts. */
export const ruleSetInput = z.object({
  rule: ruleInput,
  extra: z
    .array(z.object({ dayOfMonth: z.number().int().min(1).max(31), amount }))
    .max(10)
    .default([]),
})

function normalizeDay(input: z.output<typeof ruleInput>): number | null {
  if (input.frequency === "monthly" || input.frequency === "yearly") {
    return input.dayOfMonth ?? Number(input.startDate.slice(8, 10))
  }
  return null
}

export async function createRules(ctx: HouseholdCtx, raw: z.input<typeof ruleSetInput>) {
  assertCan(ctx, "finance.write")
  const { rule: input, extra } = ruleSetInput.parse(raw)
  if (extra.length > 0 && input.frequency !== "monthly") throw new AppError("Несколько начислений поддерживаются только для ежемесячных операций")
  const today = todayIn(ctx.timezone)
  const db = getDb()
  const base = await normalizeOperation(db, ctx, input)
  if (extra.length > 0 && base.toAmount !== null) throw new AppError("Для каждого валютного перевода создайте отдельное расписание с суммой зачисления")

  const variants = [{ dayOfMonth: normalizeDay(input), amount: input.amount }, ...extra]
  const created = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(recurringRules)
      .values(
        variants.map((v) => ({
          ...base,
          amount: v.amount,
          householdId: ctx.householdId,
          frequency: input.frequency,
          interval: input.interval,
          dayOfMonth: v.dayOfMonth,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          // Occurrences dated before the rule was created are not generated retroactively.
          generateFrom: maxDate(input.startDate, input.frequency === "once" ? input.startDate : today),
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })),
      )
      .returning()
    for (const r of rows) {
      await audit({ action: "rule.create", entityType: "recurring_rule", entityId: r.id, householdId: ctx.householdId, actorId: ctx.userId, meta: { title: r.title, amount: r.amount, frequency: r.frequency } }, tx)
    }
    return rows
  })
  for (const r of created) await materializeRule(r.id, today)
  return created
}

// ---------------------------------------------------------------------------
// Materialization (idempotent)
// ---------------------------------------------------------------------------

function nextDay(d: IsoDate | null): IsoDate | null {
  return d ? addDays(d, 1) : null
}

/**
 * Creates planned transactions for every occurrence of the rule up to `today + MATERIALIZE_DAYS`.
 *
 * Idempotent: occurrences are keyed by (rule, occurrence_date) with a unique constraint and inserted
 * with ON CONFLICT DO NOTHING; the rule row is locked so concurrent runs and edits serialize.
 */
export async function materializeRule(ruleId: string, today: IsoDate, db: DbOrTx = getDb()) {
  const horizon = addDays(today, MATERIALIZE_DAYS)
  return db.transaction(async (tx) => {
    const [rule] = await tx.select().from(recurringRules).where(eq(recurringRules.id, ruleId)).for("update")
    if (!rule) return 0
    const from = maxDate(rule.generateFrom, nextDay(rule.materializedThrough) ?? rule.generateFrom)
    const to = rule.endDate ? minDate(horizon, rule.endDate) : horizon
    if (from > to) return 0
    const dates = occurrencesBetween(rule, from, to)
    if (dates.length > 0) {
      await tx
        .insert(transactions)
        .values(
          dates.map((d) => ({
            householdId: rule.householdId,
            type: rule.type,
            status: "planned" as const,
            amount: rule.amount,
            toAmount: rule.toAmount,
            title: rule.title,
            description: rule.description,
            date: d,
            occurrenceDate: d,
            categoryId: rule.categoryId,
            accountId: rule.accountId,
            toAccountId: rule.toAccountId,
            recurringRuleId: rule.id,
            createdBy: rule.updatedBy ?? rule.createdBy,
            updatedBy: rule.updatedBy ?? rule.createdBy,
          })),
        )
        .onConflictDoNothing({ target: [transactions.recurringRuleId, transactions.occurrenceDate] })
    }
    await tx.update(recurringRules).set({ materializedThrough: to }).where(eq(recurringRules.id, rule.id))
    return dates.length
  })
}

/** Brings all rules of a household up to the materialization horizon. Cheap when nothing is due. */
export async function ensureMaterialized(householdId: string, today: IsoDate) {
  const horizon = addDays(today, MATERIALIZE_DAYS)
  const due = await getDb()
    .select({ id: recurringRules.id })
    .from(recurringRules)
    .where(
      and(
        eq(recurringRules.householdId, householdId),
        or(isNull(recurringRules.materializedThrough), lt(recurringRules.materializedThrough, horizon)),
        or(isNull(recurringRules.endDate), sql`${recurringRules.endDate} > coalesce(${recurringRules.materializedThrough}, ${recurringRules.generateFrom} - 1)`),
      ),
    )
  let created = 0
  for (const r of due) created += await materializeRule(r.id, today)
  return created
}

export interface VirtualOccurrence {
  ruleId: string
  date: IsoDate
  type: RecurringRule["type"]
  amount: number
  toAmount: number | null
  title: string
  categoryId: string | null
  accountId: string
  toAccountId: string | null
}

/**
 * Occurrences after the materialization horizon, computed on the fly for forecasts
 * (e.g. the calendar for a month half a year ahead).
 */
export async function virtualOccurrences(ctx: HouseholdCtx, from: IsoDate, to: IsoDate, today: IsoDate): Promise<VirtualOccurrence[]> {
  const db = getDb()
  const rules = await db
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.householdId, ctx.householdId), or(isNull(recurringRules.endDate), gte(recurringRules.endDate, from))))
  const out: VirtualOccurrence[] = []
  const lo = maxDate(from, today)
  for (const rule of rules) {
    const start = maxDate(lo, maxDate(rule.generateFrom, nextDay(rule.materializedThrough) ?? rule.generateFrom))
    for (const d of occurrencesBetween(rule, start, to)) {
      out.push({ ruleId: rule.id, date: d, type: rule.type, amount: rule.amount, toAmount: rule.toAmount, title: rule.title, categoryId: rule.categoryId, accountId: rule.accountId, toAccountId: rule.toAccountId })
    }
  }
  if (out.length === 0) return out
  // Exclude slots that were individually materialized ahead of the horizon (see materializeOccurrence).
  const existing = await db
    .select({ ruleId: transactions.recurringRuleId, date: transactions.occurrenceDate })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, ctx.householdId),
        inArray(transactions.recurringRuleId, [...new Set(out.map((o) => o.ruleId))]),
        gte(transactions.occurrenceDate, lo),
      ),
    )
  const taken = new Set(existing.map((e) => `${e.ruleId}:${e.date}`))
  return out.filter((o) => !taken.has(`${o.ruleId}:${o.date}`))
}

/** Creates the planned row for a single future occurrence so it can be edited, confirmed or skipped. */
export async function materializeOccurrence(ctx: HouseholdCtx, ruleId: string, rawDate: IsoDate) {
  assertCan(ctx, "finance.write")
  const date = isoDate.parse(rawDate)
  const rule = await getRule(ctx, ruleId)
  if (!occurrencesBetween(rule, date, date).includes(date) || date < rule.generateFrom) throw notFound("Операция не найдена")
  const db = getDb()
  await db
    .insert(transactions)
    .values({
      householdId: ctx.householdId,
      type: rule.type,
      status: "planned",
      amount: rule.amount,
      toAmount: rule.toAmount,
      title: rule.title,
      description: rule.description,
      date,
      occurrenceDate: date,
      categoryId: rule.categoryId,
      accountId: rule.accountId,
      toAccountId: rule.toAccountId,
      recurringRuleId: rule.id,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .onConflictDoNothing({ target: [transactions.recurringRuleId, transactions.occurrenceDate] })
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.recurringRuleId, rule.id), eq(transactions.occurrenceDate, date)))
  return row!.id
}

// ---------------------------------------------------------------------------
// Rule management
// ---------------------------------------------------------------------------

export async function getRule(ctx: HouseholdCtx, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Расписание не найдено")
  const [rule] = await getDb()
    .select()
    .from(recurringRules)
    .where(and(eq(recurringRules.id, id), eq(recurringRules.householdId, ctx.householdId)))
  if (!rule) throw notFound("Расписание не найдено")
  return rule
}

export async function listRules(ctx: HouseholdCtx) {
  assertCan(ctx, "finance.read")
  const today = todayIn(ctx.timezone)
  const rows = await getDb()
    .select({
      rule: recurringRules,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      accountName: financialAccounts.name,
      currency: financialAccounts.currency,
    })
    .from(recurringRules)
    .leftJoin(categories, eq(categories.id, recurringRules.categoryId))
    .innerJoin(financialAccounts, eq(financialAccounts.id, recurringRules.accountId))
    .where(eq(recurringRules.householdId, ctx.householdId))
    .orderBy(asc(recurringRules.type), asc(recurringRules.title))
  return rows.map((r) => {
    const finished = r.rule.endDate !== null && r.rule.endDate < today
    const next = finished ? undefined : occurrencesBetween(r.rule, today, addDays(today, 3660))[0]
    return { ...r, finished, nextDate: next ?? null }
  })
}

export const ruleUpdateInput = z.object({
  rule: ruleInput,
  version: z.number().int(),
  /** First occurrence date affected by the change ("this and all future"). Defaults to today. */
  effectiveFrom: isoDate.optional(),
})

/**
 * Changes the rule for all occurrences from `effectiveFrom` on. Confirmed operations keep their own data;
 * not-yet-confirmed occurrences from that date are regenerated with the new parameters.
 */
export async function updateRule(ctx: HouseholdCtx, id: string, raw: z.input<typeof ruleUpdateInput>) {
  assertCan(ctx, "finance.write")
  const { rule: input, version, effectiveFrom } = ruleUpdateInput.parse(raw)
  const today = todayIn(ctx.timezone)
  const from = effectiveFrom ?? today
  const db = getDb()
  const before = await getRule(ctx, id)
  if (input.type !== before.type) throw new AppError("Нельзя изменить тип регулярной операции")
  const values = await normalizeOperation(db, ctx, input, { allowArchived: true })

  await db.transaction(async (tx) => {
    const res = await tx
      .update(recurringRules)
      .set({
        ...values,
        frequency: input.frequency,
        interval: input.interval,
        dayOfMonth: normalizeDay(input),
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        generateFrom: maxDate(from, input.startDate),
        materializedThrough: null,
        version: sql`${recurringRules.version} + 1`,
        updatedBy: ctx.userId,
      })
      .where(and(eq(recurringRules.id, id), eq(recurringRules.householdId, ctx.householdId), eq(recurringRules.version, version)))
      .returning()
    if (res.length === 0) throw conflict()
    await tx
      .delete(transactions)
      .where(and(eq(transactions.recurringRuleId, id), gte(transactions.occurrenceDate, from), ne(transactions.status, "posted")))
    await audit({ action: "rule.update", entityType: "recurring_rule", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: { effectiveFrom: from, ...diff(before as unknown as Record<string, unknown>, values) } }, tx)
  })
  await materializeRule(id, today)
}

/** Ends the schedule: no occurrences after `endDate` (default: today). */
export async function stopRule(ctx: HouseholdCtx, id: string, endDate?: IsoDate) {
  assertCan(ctx, "finance.write")
  const end = endDate ? isoDate.parse(endDate) : todayIn(ctx.timezone)
  const rule = await getRule(ctx, id)
  if (end < rule.startDate) return deleteRule(ctx, id)
  await getDb().transaction(async (tx) => {
    await tx
      .update(recurringRules)
      .set({ endDate: end, version: sql`${recurringRules.version} + 1`, updatedBy: ctx.userId })
      .where(and(eq(recurringRules.id, id), eq(recurringRules.householdId, ctx.householdId)))
    await tx
      .delete(transactions)
      .where(and(eq(transactions.recurringRuleId, id), gt(transactions.occurrenceDate, end), ne(transactions.status, "posted")))
    await audit({ action: "rule.stop", entityType: "recurring_rule", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: { endDate: end } }, tx)
  })
}

/** Deletes the schedule and its pending occurrences; confirmed operations stay in history. */
export async function deleteRule(ctx: HouseholdCtx, id: string) {
  assertCan(ctx, "finance.write")
  const rule = await getRule(ctx, id)
  await getDb().transaction(async (tx) => {
    await tx.delete(transactions).where(and(eq(transactions.recurringRuleId, id), ne(transactions.status, "posted")))
    await tx.delete(recurringRules).where(and(eq(recurringRules.id, id), eq(recurringRules.householdId, ctx.householdId)))
    await audit({ action: "rule.delete", entityType: "recurring_rule", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: { title: rule.title } }, tx)
  })
}
