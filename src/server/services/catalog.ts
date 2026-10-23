import "server-only"
import { and, asc, eq, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { accountKind, categories, financialAccounts, goals, recurringRules, transactions, loans } from "@/db/schema"
import { CURRENCY_CODES } from "@/lib/currencies"
import { audit, diff } from "../audit"
import { assertCan, type HouseholdCtx } from "../context"
import { AppError, conflict, notFound } from "../errors"

const uuid = z.uuid("validation.id")

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categoryInput = z.object({
  kind: z.enum(["income", "expense"]),
  name: z.string().trim().min(1, "validation.titleRequired").max(60),
  icon: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "validation.color"),
})

export async function listCategories(ctx: HouseholdCtx, opts: { includeArchived?: boolean } = {}) {
  return getDb()
    .select()
    .from(categories)
    .where(and(eq(categories.householdId, ctx.householdId), opts.includeArchived ? undefined : isNull(categories.archivedAt)))
    .orderBy(asc(categories.kind), asc(categories.sortOrder), asc(categories.name))
}

export async function createCategory(ctx: HouseholdCtx, raw: z.input<typeof categoryInput>) {
  assertCan(ctx, "catalog.manage")
  const input = categoryInput.parse(raw)
  const [row] = await getDb()
    .insert(categories)
    .values({ ...input, householdId: ctx.householdId, sortOrder: 1000 })
    .returning()
  await audit({ action: "category.create", entityType: "category", entityId: row!.id, householdId: ctx.householdId, actorId: ctx.userId, meta: { name: input.name } })
  return row!
}

export async function updateCategory(ctx: HouseholdCtx, id: string, raw: Omit<z.input<typeof categoryInput>, "kind">) {
  assertCan(ctx, "catalog.manage")
  const input = categoryInput.omit({ kind: true }).parse(raw)
  const res = await getDb()
    .update(categories)
    .set(input)
    .where(and(eq(categories.id, uuid.parse(id)), eq(categories.householdId, ctx.householdId)))
    .returning()
  if (res.length === 0) throw notFound("category.notFound")
  await audit({ action: "category.update", entityType: "category", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: input })
}

export async function setCategoryArchived(ctx: HouseholdCtx, id: string, archived: boolean) {
  assertCan(ctx, "catalog.manage")
  const res = await getDb()
    .update(categories)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(categories.id, uuid.parse(id)), eq(categories.householdId, ctx.householdId)))
    .returning()
  if (res.length === 0) throw notFound("category.notFound")
  await audit({ action: archived ? "category.archive" : "category.restore", entityType: "category", entityId: id, householdId: ctx.householdId, actorId: ctx.userId })
}

/** Hard delete is allowed only for unused categories; otherwise history would be lost — archive instead. */
export async function deleteCategory(ctx: HouseholdCtx, id: string) {
  assertCan(ctx, "catalog.manage")
  uuid.parse(id)
  const db = getDb()
  const [used] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.categoryId, id)))
  const [usedByRules] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(recurringRules)
    .where(and(eq(recurringRules.householdId, ctx.householdId), eq(recurringRules.categoryId, id)))
  if ((used?.n ?? 0) > 0 || (usedByRules?.n ?? 0) > 0) {
    throw new AppError("category.inUse")
  }
  const res = await db
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, ctx.householdId)))
    .returning()
  if (res.length === 0) throw notFound("category.notFound")
  await audit({ action: "category.delete", entityType: "category", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: { name: res[0]!.name } })
}

// ---------------------------------------------------------------------------
// Financial accounts
// ---------------------------------------------------------------------------

export const accountInput = z.object({
  name: z.string().trim().min(1, "validation.titleRequired").max(60),
  kind: z.enum(accountKind.enumValues),
  currency: z.enum(CURRENCY_CODES).optional(),
  /** Minor units; negative allowed (credit card debt, overdraft). */
  openingBalance: z.number().int().safe(),
  creditLimit: z.number().int().min(0).max(100_000_000_000_000).default(0),
})

/**
 * Accounts with their current balance: opening balance plus all posted operations.
 * Transfers debit the source amount and credit the destination amount in their own currencies.
 */
export async function listAccounts(ctx: HouseholdCtx, opts: { includeArchived?: boolean } = {}) {
  const t = transactions
  const a = financialAccounts
  const balanceDelta = sql<string>`coalesce(sum(
    case
      when ${t.type} = 'income' then ${t.amount}
      when ${t.type} = 'expense' then -${t.amount}
      when ${t.type} = 'transfer' and ${t.accountId} = ${a.id} then -${t.amount}
      when ${t.type} = 'transfer' and ${t.toAccountId} = ${a.id} then coalesce(${t.toAmount}, ${t.amount})
      else 0
    end), 0)`
  const rows = await getDb()
    .select({
      id: a.id,
      name: a.name,
      kind: a.kind,
      version: a.version,
      currency: a.currency,
      openingBalance: a.openingBalance,
      creditLimit: a.creditLimit,
      archivedAt: a.archivedAt,
      sortOrder: a.sortOrder,
      delta: sql<string>`${balanceDelta} + coalesce((select sum(e.balance_delta) from loan_events e join loans l on l.id = e.loan_id and l.household_id = e.household_id where l.household_id = ${a.householdId} and l.account_id = ${a.id}), 0)`,
      operations: sql<number>`(select count(*)::int from transactions u where u.household_id = ${a.householdId} and (u.account_id = ${a.id} or u.to_account_id = ${a.id}))`,
      currencyLocked: sql<boolean>`exists(select 1 from transactions u where u.household_id = ${a.householdId} and (u.account_id = ${a.id} or u.to_account_id = ${a.id})) or exists(select 1 from recurring_rules r where r.household_id = ${a.householdId} and (r.account_id = ${a.id} or r.to_account_id = ${a.id})) or exists(select 1 from goals g where g.household_id = ${a.householdId} and g.account_id = ${a.id})`,
    })
    .from(a)
    .leftJoin(t, and(eq(t.status, "posted"), eq(t.householdId, a.householdId), or(eq(t.accountId, a.id), eq(t.toAccountId, a.id))))
    .where(and(eq(a.householdId, ctx.householdId), opts.includeArchived ? undefined : isNull(a.archivedAt)))
    .groupBy(a.id)
    .orderBy(asc(a.sortOrder), asc(a.createdAt))
  return rows.map(({ delta, ...r }) => ({ ...r, balance: r.openingBalance + Number(delta) }))
}

export async function createAccount(ctx: HouseholdCtx, raw: z.input<typeof accountInput>) {
  assertCan(ctx, "catalog.manage")
  const input = accountInput.parse(raw)
  if (input.kind === "loan") throw new AppError("account.createLoan")
  const [row] = await getDb()
    .insert(financialAccounts)
    .values({ ...input, householdId: ctx.householdId, currency: input.currency ?? ctx.currency, sortOrder: 100 })
    .returning()
  await audit({ action: "account.create", entityType: "account", entityId: row!.id, householdId: ctx.householdId, actorId: ctx.userId, meta: { name: input.name } })
  return row!
}

export async function updateAccount(ctx: HouseholdCtx, id: string, raw: z.input<typeof accountInput> & { version?: number }) {
  assertCan(ctx, "catalog.manage")
  const input = accountInput.parse(raw)
  const db = getDb()
  const [before] = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.id, uuid.parse(id)), eq(financialAccounts.householdId, ctx.householdId)))
  if (!before) throw notFound("account.notFound")
  if (before.kind === "loan" || input.kind === "loan") throw new AppError("account.manageLoan")
  const [loan] = await db.select({ id: loans.id }).from(loans).where(and(eq(loans.householdId, ctx.householdId), eq(loans.paymentAccountId, id))).limit(1)
  if (loan && input.currency && input.currency !== before.currency) throw new AppError("account.loanCurrency")
  if (input.currency && input.currency !== before.currency) {
    const [used] = await db.select({ id: transactions.id }).from(transactions).where(and(eq(transactions.householdId, ctx.householdId), or(eq(transactions.accountId, id), eq(transactions.toAccountId, id)))).limit(1)
    const [rule] = await db.select({ id: recurringRules.id }).from(recurringRules).where(and(eq(recurringRules.householdId, ctx.householdId), or(eq(recurringRules.accountId, id), eq(recurringRules.toAccountId, id)))).limit(1)
    const [goal] = await db.select({ id: goals.id }).from(goals).where(and(eq(goals.householdId, ctx.householdId), eq(goals.accountId, id))).limit(1)
    if (used || rule || goal) throw new AppError("account.currencyLocked")
  }
  const version = z.number().int().positive().parse(raw.version ?? before.version)
  const updated = await db.update(financialAccounts).set({ ...input, version: sql`${financialAccounts.version} + 1` }).where(and(eq(financialAccounts.id, id), eq(financialAccounts.householdId, ctx.householdId), eq(financialAccounts.version, version))).returning()
  if (!updated.length) throw conflict()
  await audit({ action: "account.update", entityType: "account", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: diff(before, input) })
}

export async function setAccountArchived(ctx: HouseholdCtx, id: string, archived: boolean) {
  assertCan(ctx, "catalog.manage")
  uuid.parse(id)
  const db = getDb()
  const [loan] = await db.select({ id: loans.id }).from(loans).where(and(eq(loans.householdId, ctx.householdId), or(eq(loans.accountId, id), eq(loans.paymentAccountId, id)))).limit(1)
  if (loan) throw new AppError("account.loanInUse")
  if (archived) {
    const [active] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(financialAccounts)
      .where(and(eq(financialAccounts.householdId, ctx.householdId), isNull(financialAccounts.archivedAt)))
    if ((active?.n ?? 0) <= 1) throw new AppError("account.lastActive")
  }
  const res = await db
    .update(financialAccounts)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(financialAccounts.id, id), eq(financialAccounts.householdId, ctx.householdId)))
    .returning()
  if (res.length === 0) throw notFound("account.notFound")
  await audit({ action: archived ? "account.archive" : "account.restore", entityType: "account", entityId: id, householdId: ctx.householdId, actorId: ctx.userId })
}

export async function deleteAccount(ctx: HouseholdCtx, id: string) {
  assertCan(ctx, "catalog.manage")
  uuid.parse(id)
  const db = getDb()
  const [loan] = await db.select({ id: loans.id }).from(loans).where(and(eq(loans.householdId, ctx.householdId), or(eq(loans.accountId, id), eq(loans.paymentAccountId, id)))).limit(1)
  if (loan) throw new AppError("account.loanInUse")
  const [used] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), or(eq(transactions.accountId, id), eq(transactions.toAccountId, id))))
  const [usedByRules] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(recurringRules)
    .where(and(eq(recurringRules.householdId, ctx.householdId), or(eq(recurringRules.accountId, id), eq(recurringRules.toAccountId, id))))
  if ((used?.n ?? 0) > 0 || (usedByRules?.n ?? 0) > 0) {
    throw new AppError("account.inUse")
  }
  const [active] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(financialAccounts)
    .where(and(eq(financialAccounts.householdId, ctx.householdId), isNull(financialAccounts.archivedAt)))
  if ((active?.n ?? 0) <= 1) throw new AppError("account.lastAccount")
  const [goal] = await db.select({ id: goals.id }).from(goals).where(and(eq(goals.householdId, ctx.householdId), eq(goals.accountId, id))).limit(1)
  if (goal) throw new AppError("account.goalInUse")
  const res = await db
    .delete(financialAccounts)
    .where(and(eq(financialAccounts.id, id), eq(financialAccounts.householdId, ctx.householdId)))
    .returning()
  if (res.length === 0) throw notFound("account.notFound")
  await audit({ action: "account.delete", entityType: "account", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: { name: res[0]!.name } })
}
