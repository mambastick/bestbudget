import "server-only"
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"
import { getDb, type DbOrTx } from "@/db"
import { categories, financialAccounts, transactions, users, type Transaction } from "@/db/schema"
import { isIsoDate, type IsoDate } from "@/lib/dates"
import { audit, diff } from "../audit"
import { assertCan, type HouseholdCtx } from "../context"
import { AppError, conflict, notFound } from "../errors"

export const isoDate = z.string().refine(isIsoDate, "Некорректная дата")
export const amount = z
  .number({ error: "Укажите сумму" })
  .int()
  .positive("Сумма должна быть больше нуля")
  .max(1_000_000_000_000_00, "Слишком большая сумма")

/** Fields shared by one-off operations and recurring rules. */
export const operationFields = z.object({
  type: z.enum(["income", "expense", "transfer"]),
  amount,
  toAmount: amount.nullable().optional(),
  title: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().max(1000).optional().nullable(),
  categoryId: z.uuid().nullable().optional(),
  accountId: z.uuid({ error: "Выберите счёт" }),
  toAccountId: z.uuid().nullable().optional(),
})

export const transactionInput = operationFields.extend({
  date: isoDate,
  status: z.enum(["planned", "posted"]),
})
export type TransactionInput = z.input<typeof transactionInput>

type OperationFields = z.output<typeof operationFields>

/**
 * Validates references (same household, matching category kind, active accounts)
 * and fills a default title. Returns normalized column values.
 */
export async function normalizeOperation(db: DbOrTx, ctx: HouseholdCtx, input: OperationFields, opts: { allowArchived?: boolean } = {}) {
  const isTransfer = input.type === "transfer"
  const categoryId = isTransfer ? null : (input.categoryId ?? null)
  const toAccountId = isTransfer ? (input.toAccountId ?? null) : null

  if (!isTransfer && !categoryId) throw new AppError("Выберите категорию")
  if (isTransfer && !toAccountId) throw new AppError("Выберите счёт зачисления")
  if (isTransfer && toAccountId === input.accountId) throw new AppError("Счета списания и зачисления должны различаться")

  const accountIds = [input.accountId, ...(toAccountId ? [toAccountId] : [])]
  const accounts = await db
    .select({ id: financialAccounts.id, name: financialAccounts.name, archivedAt: financialAccounts.archivedAt, currency: financialAccounts.currency })
    .from(financialAccounts)
    .where(and(eq(financialAccounts.householdId, ctx.householdId), inArray(financialAccounts.id, accountIds)))
  if (accounts.length !== accountIds.length) throw notFound("Счёт не найден")
  if (!opts.allowArchived && accounts.some((a) => a.archivedAt)) throw new AppError("Счёт находится в архиве")

  const fromAccount = accounts.find((a) => a.id === input.accountId)!
  const toAccount = accounts.find((a) => a.id === toAccountId)
  const crossCurrency = isTransfer && fromAccount.currency !== toAccount?.currency
  if (crossCurrency && !input.toAmount) throw new AppError("Укажите сумму зачисления в валюте получателя")
  if (isTransfer && !crossCurrency && input.toAmount != null && input.toAmount !== input.amount) {
    throw new AppError("В одной валюте суммы списания и зачисления должны совпадать")
  }

  let title = input.title
  if (categoryId) {
    const [cat] = await db
      .select({ kind: categories.kind, name: categories.name })
      .from(categories)
      .where(and(eq(categories.householdId, ctx.householdId), eq(categories.id, categoryId)))
    if (!cat) throw notFound("Категория не найдена")
    if (cat.kind !== input.type) throw new AppError("Категория не соответствует типу операции")
    title ||= cat.name
  }
  title ||= "Перевод"

  return {
    type: input.type,
    amount: input.amount,
    toAmount: crossCurrency ? input.toAmount! : null,
    title,
    description: input.description || null,
    categoryId,
    accountId: input.accountId,
    toAccountId,
  }
}

export async function createTransaction(ctx: HouseholdCtx, raw: TransactionInput) {
  assertCan(ctx, "finance.write")
  const input = transactionInput.parse(raw)
  const db = getDb()
  const values = await normalizeOperation(db, ctx, input)
  const [row] = await db
    .insert(transactions)
    .values({
      ...values,
      householdId: ctx.householdId,
      date: input.date,
      status: input.status,
      postedAt: input.status === "posted" ? new Date() : null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning()
  await audit({
    action: "transaction.create",
    entityType: "transaction",
    entityId: row!.id,
    householdId: ctx.householdId,
    actorId: ctx.userId,
    meta: { type: row!.type, amount: row!.amount, date: row!.date, status: row!.status },
  })
  return row!
}

async function getOwned(db: DbOrTx, ctx: HouseholdCtx, id: string): Promise<Transaction> {
  if (!z.uuid().safeParse(id).success) throw notFound("Операция не найдена")
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, ctx.householdId)))
  if (!row) throw notFound("Операция не найдена")
  return row
}

/**
 * Updates a row with optimistic concurrency control: the write succeeds only if
 * nobody changed the row since the client loaded `version`.
 */
async function updateVersioned(ctx: HouseholdCtx, before: Transaction, version: number, patch: Partial<Transaction>, action: string) {
  const db = getDb()
  const res = await db
    .update(transactions)
    .set({ ...patch, version: sql`${transactions.version} + 1`, updatedBy: ctx.userId })
    .where(and(eq(transactions.id, before.id), eq(transactions.householdId, ctx.householdId), eq(transactions.version, version)))
    .returning()
  if (res.length === 0) throw conflict()
  await audit({
    action,
    entityType: "transaction",
    entityId: before.id,
    householdId: ctx.householdId,
    actorId: ctx.userId,
    meta: diff(before as unknown as Record<string, unknown>, patch as Record<string, unknown>),
  })
  return res[0]!
}

export async function updateTransaction(ctx: HouseholdCtx, id: string, raw: TransactionInput & { version: number }) {
  assertCan(ctx, "finance.write")
  const input = transactionInput.parse(raw)
  const version = z.number().int().parse(raw.version)
  const db = getDb()
  const before = await getOwned(db, ctx, id)
  if (before.recurringRuleId && input.type !== before.type) throw new AppError("Нельзя изменить тип операции из расписания")
  const values = await normalizeOperation(db, ctx, input, { allowArchived: true })
  return updateVersioned(
    ctx,
    before,
    version,
    {
      ...values,
      date: input.date,
      status: input.status,
      postedAt: input.status === "posted" ? (before.postedAt ?? new Date()) : null,
    },
    "transaction.update",
  )
}

export const confirmInput = z.object({
  version: z.number().int(),
  amount: amount.optional(),
  toAmount: amount.optional(),
  date: isoDate.optional(),
})

/** Marks a planned operation as actually done, optionally with the real amount and date. */
export async function confirmTransaction(ctx: HouseholdCtx, id: string, raw: z.input<typeof confirmInput>) {
  assertCan(ctx, "finance.write")
  const input = confirmInput.parse(raw)
  const before = await getOwned(getDb(), ctx, id)
  if (before.status === "posted") throw new AppError("Операция уже подтверждена")
  const values = await normalizeOperation(getDb(), ctx, operationFields.parse({
    ...before, amount: input.amount ?? before.amount, toAmount: input.toAmount ?? before.toAmount,
  }), { allowArchived: true })
  return updateVersioned(
    ctx,
    before,
    input.version,
    { ...values, status: "posted", postedAt: new Date(), date: input.date ?? before.date },
    "transaction.confirm",
  )
}

/** Moves an operation back to planned (undo confirm / undo skip). */
export async function unconfirmTransaction(ctx: HouseholdCtx, id: string, version: number) {
  assertCan(ctx, "finance.write")
  const before = await getOwned(getDb(), ctx, id)
  return updateVersioned(ctx, before, version, { status: "planned", postedAt: null }, "transaction.unconfirm")
}

export async function skipTransaction(ctx: HouseholdCtx, id: string, version: number) {
  assertCan(ctx, "finance.write")
  const before = await getOwned(getDb(), ctx, id)
  if (!before.recurringRuleId) throw new AppError("Пропустить можно только регулярную операцию")
  if (before.status === "posted") throw new AppError("Подтверждённую операцию нельзя пропустить")
  return updateVersioned(ctx, before, version, { status: "skipped", postedAt: null }, "transaction.skip")
}

/**
 * Deletes a one-off operation. Occurrences of a schedule are marked as skipped instead,
 * so the generator does not recreate them.
 */
export async function deleteTransaction(ctx: HouseholdCtx, id: string) {
  assertCan(ctx, "finance.write")
  const db = getDb()
  const before = await getOwned(db, ctx, id)
  if (before.recurringRuleId && before.status !== "posted") {
    await updateVersioned(ctx, before, before.version, { status: "skipped", postedAt: null }, "transaction.skip")
    return { skipped: true }
  }
  if (before.recurringRuleId) {
    // A posted occurrence: keep the slot taken by a skipped row so it is not regenerated.
    await updateVersioned(ctx, before, before.version, { status: "skipped", postedAt: null }, "transaction.delete")
    return { skipped: true }
  }
  await db.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.householdId, ctx.householdId)))
  await audit({
    action: "transaction.delete",
    entityType: "transaction",
    entityId: id,
    householdId: ctx.householdId,
    actorId: ctx.userId,
    meta: { type: before.type, amount: before.amount, date: before.date, title: before.title },
  })
  return { skipped: false }
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export const transactionFilters = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(["income", "expense", "transfer"]).optional(),
  status: z.enum(["planned", "posted", "skipped"]).optional(),
  categoryId: z.uuid().optional(),
  accountId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
})
export type TransactionFilters = z.input<typeof transactionFilters>

export const PAGE_SIZE = 50

const toAccounts = alias(financialAccounts, "to_accounts")
const authors = alias(users, "authors")

export const transactionListColumns = {
  id: transactions.id,
  type: transactions.type,
  status: transactions.status,
  amount: transactions.amount,
  toAmount: transactions.toAmount,
  currency: financialAccounts.currency,
  toCurrency: toAccounts.currency,
  title: transactions.title,
  description: transactions.description,
  date: transactions.date,
  occurrenceDate: transactions.occurrenceDate,
  categoryId: transactions.categoryId,
  accountId: transactions.accountId,
  toAccountId: transactions.toAccountId,
  recurringRuleId: transactions.recurringRuleId,
  version: transactions.version,
  updatedAt: transactions.updatedAt,
  categoryName: categories.name,
  categoryIcon: categories.icon,
  categoryColor: categories.color,
  accountName: financialAccounts.name,
  toAccountName: toAccounts.name,
  authorName: authors.name,
}

export type TransactionRow = Awaited<ReturnType<typeof listTransactions>>["rows"][number]

export function transactionListQuery(where: SQL | undefined) {
  return getDb()
    .select(transactionListColumns)
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
    .leftJoin(toAccounts, eq(toAccounts.id, transactions.toAccountId))
    .leftJoin(authors, eq(authors.id, sql`coalesce(${transactions.updatedBy}, ${transactions.createdBy})`))
    .where(where)
}

function filterConditions(ctx: HouseholdCtx, f: z.output<typeof transactionFilters>) {
  const conditions: (SQL | undefined)[] = [
    eq(transactions.householdId, ctx.householdId),
    f.type ? eq(transactions.type, f.type) : undefined,
    f.status ? eq(transactions.status, f.status) : sql`${transactions.status} <> 'skipped'`,
    f.categoryId ? eq(transactions.categoryId, f.categoryId) : undefined,
    f.accountId ? or(eq(transactions.accountId, f.accountId), eq(transactions.toAccountId, f.accountId)) : undefined,
    f.from ? gte(transactions.date, f.from) : undefined,
    f.to ? lte(transactions.date, f.to) : undefined,
  ]
  if (f.q) {
    const pattern = `%${f.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`
    conditions.push(or(ilike(transactions.title, pattern), ilike(transactions.description, pattern), ilike(categories.name, pattern)))
  }
  return and(...conditions)
}

export async function listTransactions(ctx: HouseholdCtx, raw: TransactionFilters) {
  assertCan(ctx, "finance.read")
  const f = transactionFilters.parse(raw)
  const rows = await transactionListQuery(filterConditions(ctx, f))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset((f.page - 1) * PAGE_SIZE)
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE, page: f.page }
}

/** Upper bound for a single export; a family accumulates far fewer operations. */
const EXPORT_LIMIT = 50_000

/** All operations matching the filters (no paging), oldest first — for CSV export. */
export async function exportTransactions(ctx: HouseholdCtx, raw: TransactionFilters) {
  assertCan(ctx, "finance.read")
  const f = transactionFilters.parse(raw)
  return transactionListQuery(filterConditions(ctx, f)).orderBy(transactions.date, transactions.createdAt).limit(EXPORT_LIMIT)
}

export async function getTransaction(ctx: HouseholdCtx, id: string) {
  assertCan(ctx, "finance.read")
  if (!z.uuid().safeParse(id).success) throw notFound("Операция не найдена")
  const [row] = await transactionListQuery(and(eq(transactions.id, id), eq(transactions.householdId, ctx.householdId)))
  if (!row) throw notFound("Операция не найдена")
  return row
}

/** Rows touching the given dates (used by the calendar and upcoming lists). */
export async function listInRange(ctx: HouseholdCtx, from: IsoDate, to: IsoDate, opts: { overdueBefore?: IsoDate } = {}) {
  const range = and(gte(transactions.date, from), lte(transactions.date, to))
  // Overdue planned items are shown too: they are still expected.
  const overdue = opts.overdueBefore
    ? and(eq(transactions.status, "planned"), sql`${transactions.date} < ${opts.overdueBefore}`)
    : undefined
  return transactionListQuery(
    and(eq(transactions.householdId, ctx.householdId), sql`${transactions.status} <> 'skipped'`, overdue ? or(range, overdue) : range),
  ).orderBy(transactions.date, transactions.createdAt)
}

