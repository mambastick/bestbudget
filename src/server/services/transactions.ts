import "server-only"
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"
import { getDb, type DbOrTx } from "@/db"
import { categories, financialAccounts, importRows, transactions, users, type Transaction } from "@/db/schema"
import { isIsoDate, type IsoDate } from "@/lib/dates"
import { audit, diff } from "../audit"
import { assertCan, type HouseholdCtx } from "../context"
import { AppError, conflict, notFound } from "../errors"

export const isoDate = z.string().refine(isIsoDate, "validation.date")
export const amount = z
  .number({ error: "validation.amount" })
  .int()
  .positive("validation.positiveAmount")
  .max(1_000_000_000_000_00, "validation.largeAmount")

/** Fields shared by one-off operations and recurring rules. */
export const operationFields = z.object({
  type: z.enum(["income", "expense", "transfer"]),
  amount,
  toAmount: amount.nullable().optional(),
  title: z.string().trim().max(120).optional().default(""),
  description: z.string().trim().max(1000).optional().nullable(),
  categoryId: z.uuid().nullable().optional(),
  accountId: z.uuid({ error: "validation.account" }),
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

  if (!isTransfer && !categoryId) throw new AppError("transaction.categoryRequired")
  if (isTransfer && !toAccountId) throw new AppError("transaction.destinationRequired")
  if (isTransfer && toAccountId === input.accountId) throw new AppError("transaction.differentAccounts")

  const accountIds = [input.accountId, ...(toAccountId ? [toAccountId] : [])]
  const accounts = await db
    .select({ id: financialAccounts.id, name: financialAccounts.name, archivedAt: financialAccounts.archivedAt, currency: financialAccounts.currency, kind: financialAccounts.kind })
    .from(financialAccounts)
    .where(and(eq(financialAccounts.householdId, ctx.householdId), inArray(financialAccounts.id, accountIds)))
  if (accounts.some((a) => a.kind === "loan")) throw new AppError("transaction.useLoans")
  if (accounts.length !== accountIds.length) throw notFound("account.notFound")
  if (!opts.allowArchived && accounts.some((a) => a.archivedAt)) throw new AppError("account.archived")

  const fromAccount = accounts.find((a) => a.id === input.accountId)!
  const toAccount = accounts.find((a) => a.id === toAccountId)
  const crossCurrency = isTransfer && fromAccount.currency !== toAccount?.currency
  if (crossCurrency && !input.toAmount) throw new AppError("transaction.destinationAmountRequired")
  if (isTransfer && !crossCurrency && input.toAmount != null && input.toAmount !== input.amount) {
    throw new AppError("transaction.sameCurrencyAmounts")
  }

  let title = input.title
  if (categoryId) {
    const [cat] = await db
      .select({ kind: categories.kind, name: categories.name })
      .from(categories)
      .where(and(eq(categories.householdId, ctx.householdId), eq(categories.id, categoryId)))
    if (!cat) throw notFound("category.notFound")
    if (cat.kind !== input.type) throw new AppError("transaction.categoryType")
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

export async function createTransaction(ctx: HouseholdCtx, raw: TransactionInput, db: DbOrTx = getDb()) {
  assertCan(ctx, "finance.write")
  const input = transactionInput.parse(raw)
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
  }, db)
  return row!
}

async function getOwned(db: DbOrTx, ctx: HouseholdCtx, id: string): Promise<Transaction> {
  if (!z.uuid().safeParse(id).success) throw notFound("transaction.notFound")
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, ctx.householdId)))
  if (!row) throw notFound("transaction.notFound")
  return row
}

/**
 * Updates a row with optimistic concurrency control: the write succeeds only if
 * nobody changed the row since the client loaded `version`.
 */
async function updateVersioned(ctx: HouseholdCtx, before: Transaction, version: number, patch: Partial<Transaction>, action: string, db: DbOrTx = getDb()) {
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
  }, db)
  return res[0]!
}

export async function updateTransaction(ctx: HouseholdCtx, id: string, raw: TransactionInput & { version: number }, db: DbOrTx = getDb()) {
  assertCan(ctx, "finance.write")
  const input = transactionInput.parse(raw)
  const version = z.number().int().parse(raw.version)
  const before = await getOwned(db, ctx, id)
  if (before.loanId) throw new AppError("transaction.wholeLoanPayment")
  if (before.recurringRuleId && input.type !== before.type) throw new AppError("transaction.recurringTypeLocked")
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
    "transaction.update", db,
  )
}

export const confirmInput = z.object({
  version: z.number().int(),
  amount: amount.optional(),
  toAmount: amount.optional(),
  date: isoDate.optional(),
})

/** Marks a planned operation as actually done, optionally with the real amount and date. */
export async function confirmTransaction(ctx: HouseholdCtx, id: string, raw: z.input<typeof confirmInput>, db: DbOrTx = getDb()) {
  assertCan(ctx, "finance.write")
  const input = confirmInput.parse(raw)
  const before = await getOwned(db, ctx, id)
  if (before.loanId) throw new AppError("transaction.wholeLoanPayment")
  if (before.status === "posted") throw new AppError("transaction.alreadyPosted")
  const values = await normalizeOperation(db, ctx, operationFields.parse({
    ...before, amount: input.amount ?? before.amount, toAmount: input.toAmount ?? before.toAmount,
  }), { allowArchived: true })
  return updateVersioned(
    ctx,
    before,
    input.version,
    { ...values, status: "posted", postedAt: new Date(), date: input.date ?? before.date },
    "transaction.confirm", db,
  )
}

/** Moves an operation back to planned (undo confirm / undo skip). */
export async function unconfirmTransaction(ctx: HouseholdCtx, id: string, version: number) {
  assertCan(ctx, "finance.write")
  const before = await getOwned(getDb(), ctx, id)
  if (before.loanId) throw new AppError("transaction.wholeLoanPayment")
  return updateVersioned(ctx, before, version, { status: "planned", postedAt: null }, "transaction.unconfirm")
}

export async function skipTransaction(ctx: HouseholdCtx, id: string, version: number) {
  assertCan(ctx, "finance.write")
  const before = await getOwned(getDb(), ctx, id)
  if (before.loanId) throw new AppError("transaction.wholeLoanPayment")
  if (!before.recurringRuleId) throw new AppError("transaction.recurringOnly")
  if (before.status === "posted") throw new AppError("transaction.postedCannotSkip")
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
  if (before.loanId) throw new AppError("transaction.wholeLoanPayment")
  if (before.recurringRuleId && before.status !== "posted") {
    await updateVersioned(ctx, before, before.version, { status: "skipped", postedAt: null }, "transaction.skip")
    return { skipped: true }
  }
  if (before.recurringRuleId) {
    // A posted occurrence: keep the slot taken by a skipped row so it is not regenerated.
    await updateVersioned(ctx, before, before.version, { status: "skipped", postedAt: null }, "transaction.delete")
    return { skipped: true }
  }
  await db.transaction(async (tx) => {
    await tx.update(importRows).set({ transactionId: null }).where(and(eq(importRows.householdId, ctx.householdId), eq(importRows.transactionId, id)))
    await tx.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.householdId, ctx.householdId)))
    await audit({
      action: "transaction.delete",
      entityType: "transaction",
      entityId: id,
      householdId: ctx.householdId,
      actorId: ctx.userId,
      meta: { type: before.type, amount: before.amount, date: before.date, title: before.title },
    }, tx)
  })
  return { skipped: false }
}

/** Restores the exact pre-import financial fields while keeping optimistic versions monotonic. */
export async function restoreImportedTransaction(ctx: HouseholdCtx, snapshot: Transaction, version: number, db: DbOrTx) {
  assertCan(ctx, "finance.write")
  const before = await getOwned(db, ctx, snapshot.id)
  const values = await normalizeOperation(db, ctx, operationFields.parse(snapshot), { allowArchived: true })
  const rows = await db.update(transactions).set({ ...values, date: snapshot.date, status: snapshot.status, postedAt: snapshot.postedAt ? new Date(snapshot.postedAt) : null, version: sql`${transactions.version} + 1`, updatedBy: ctx.userId })
    .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.id, before.id), eq(transactions.version, version))).returning()
  if (!rows.length) throw conflict()
  await audit({ action: "transaction.import_restore", entityType: "transaction", entityId: before.id, householdId: ctx.householdId, actorId: ctx.userId }, db)
}

export async function removeImportedTransaction(ctx: HouseholdCtx, id: string, version: number, db: DbOrTx) {
  assertCan(ctx, "finance.write")
  const rows = await db.delete(transactions).where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.id, id), eq(transactions.version, version))).returning({ id: transactions.id })
  if (!rows.length) throw conflict()
  await audit({ action: "transaction.import_delete", entityType: "transaction", entityId: id, householdId: ctx.householdId, actorId: ctx.userId }, db)
}

/** Own exports can preserve skipped rows without treating a bank rejection as a transaction. */
export async function createExportedTransaction(ctx: HouseholdCtx, raw: TransactionInput, status: "planned" | "skipped", db: DbOrTx) {
  const row = await createTransaction(ctx, { ...raw, status: "planned" }, db)
  return status === "skipped" ? updateVersioned(ctx, row, row.version, { status: "skipped" }, "transaction.import_skipped", db) : row
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
  loanId: transactions.loanId,
  loanPart: transactions.loanPart,
  loanPaymentKey: transactions.loanPaymentKey,
  loanDueDate: transactions.loanDueDate,
  loanPrincipal: sql<number>`coalesce((select sum(p.amount)::bigint from transactions p where p.household_id = ${transactions.householdId} and p.loan_payment_key = ${transactions.loanPaymentKey} and p.loan_part in ('principal', 'prepayment')), 0)`.mapWith(Number),
  loanInterest: sql<number>`coalesce((select sum(p.amount)::bigint from transactions p where p.household_id = ${transactions.householdId} and p.loan_payment_key = ${transactions.loanPaymentKey} and p.loan_part = 'interest'), 0)`.mapWith(Number),
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

/** One display row per payment; the export keeps the two original ledger entries. */
export const loanDisplayCondition = sql`(${transactions.loanPart} is distinct from 'interest' or not exists (select 1 from transactions p where p.household_id = ${transactions.householdId} and p.loan_payment_key = ${transactions.loanPaymentKey} and p.loan_part = 'principal'))`

export function transactionListQuery(where: SQL | undefined, display = true) {
  return getDb()
    .select({ ...transactionListColumns,
      amount: display ? sql<number>`case when ${transactions.loanId} is not null then (select sum(p.amount)::bigint from transactions p where p.household_id = ${transactions.householdId} and p.loan_payment_key = ${transactions.loanPaymentKey}) else ${transactions.amount} end`.mapWith(Number) : transactions.amount,
      title: sql<string>`case when ${transactions.loanId} is not null then ${transactions.title} || ': ' || (select a.name from loans l join financial_accounts a on a.id = l.account_id and a.household_id = l.household_id where l.id = ${transactions.loanId} and l.household_id = ${transactions.householdId}) else ${transactions.title} end`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .innerJoin(financialAccounts, eq(financialAccounts.id, transactions.accountId))
    .leftJoin(toAccounts, eq(toAccounts.id, transactions.toAccountId))
    .leftJoin(authors, eq(authors.id, sql`coalesce(${transactions.updatedBy}, ${transactions.createdBy})`))
    .where(where)
}

function filterConditions(ctx: HouseholdCtx, f: z.output<typeof transactionFilters>, grouped = true) {
  const conditions: (SQL | undefined)[] = [
    eq(transactions.householdId, ctx.householdId),
    f.type ? grouped ? or(eq(transactions.type, f.type), sql`exists (select 1 from transactions p where p.household_id = ${transactions.householdId} and p.loan_payment_key = ${transactions.loanPaymentKey} and p.type = ${f.type})`) : eq(transactions.type, f.type) : undefined,
    f.status ? eq(transactions.status, f.status) : sql`${transactions.status} <> 'skipped'`,
    f.categoryId ? grouped ? or(eq(transactions.categoryId, f.categoryId), sql`exists (select 1 from transactions p where p.household_id = ${transactions.householdId} and p.loan_payment_key = ${transactions.loanPaymentKey} and p.category_id = ${f.categoryId})`) : eq(transactions.categoryId, f.categoryId) : undefined,
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
  const rows = await transactionListQuery(and(filterConditions(ctx, f), loanDisplayCondition))
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
  return transactionListQuery(filterConditions(ctx, f, false), false).orderBy(transactions.date, transactions.createdAt).limit(EXPORT_LIMIT)
}

export async function getTransaction(ctx: HouseholdCtx, id: string) {
  assertCan(ctx, "finance.read")
  if (!z.uuid().safeParse(id).success) throw notFound("transaction.notFound")
  const [row] = await transactionListQuery(and(eq(transactions.id, id), eq(transactions.householdId, ctx.householdId)))
  if (!row) throw notFound("transaction.notFound")
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
    and(eq(transactions.householdId, ctx.householdId), loanDisplayCondition, sql`${transactions.status} <> 'skipped'`, overdue ? or(range, overdue) : range),
  ).orderBy(transactions.date, transactions.createdAt)
}
