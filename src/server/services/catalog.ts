import "server-only"
import { and, asc, eq, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { accountKind, categories, financialAccounts, recurringRules, transactions } from "@/db/schema"
import { audit, diff } from "../audit"
import { assertCan, type HouseholdCtx } from "../context"
import { AppError, notFound } from "../errors"

const uuid = z.uuid("Некорректный идентификатор")

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const categoryInput = z.object({
  kind: z.enum(["income", "expense"]),
  name: z.string().trim().min(1, "Укажите название").max(60),
  icon: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/),
  color: z.string().regex(/^#[0-9a-f]{6}$/i, "Некорректный цвет"),
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
  if (res.length === 0) throw notFound("Категория не найдена")
  await audit({ action: "category.update", entityType: "category", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: input })
}

export async function setCategoryArchived(ctx: HouseholdCtx, id: string, archived: boolean) {
  assertCan(ctx, "catalog.manage")
  const res = await getDb()
    .update(categories)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(categories.id, uuid.parse(id)), eq(categories.householdId, ctx.householdId)))
    .returning()
  if (res.length === 0) throw notFound("Категория не найдена")
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
    throw new AppError("Категория используется в операциях. Архивируйте её — история сохранится.")
  }
  const res = await db
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.householdId, ctx.householdId)))
    .returning()
  if (res.length === 0) throw notFound("Категория не найдена")
  await audit({ action: "category.delete", entityType: "category", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: { name: res[0]!.name } })
}

// ---------------------------------------------------------------------------
// Financial accounts
// ---------------------------------------------------------------------------

export const accountInput = z.object({
  name: z.string().trim().min(1, "Укажите название").max(60),
  kind: z.enum(accountKind.enumValues),
  /** Minor units; negative allowed (credit card debt, overdraft). */
  openingBalance: z.number().int().safe(),
})

/**
 * Accounts with their current balance: opening balance plus all posted operations.
 * Transfers decrease the source and increase the destination, so the total is unchanged.
 */
export async function listAccounts(ctx: HouseholdCtx, opts: { includeArchived?: boolean } = {}) {
  const t = transactions
  const a = financialAccounts
  const balanceDelta = sql<string>`coalesce(sum(
    case
      when ${t.type} = 'income' then ${t.amount}
      when ${t.type} = 'expense' then -${t.amount}
      when ${t.type} = 'transfer' and ${t.accountId} = ${a.id} then -${t.amount}
      when ${t.type} = 'transfer' and ${t.toAccountId} = ${a.id} then ${t.amount}
      else 0
    end), 0)`
  const rows = await getDb()
    .select({
      id: a.id,
      name: a.name,
      kind: a.kind,
      currency: a.currency,
      openingBalance: a.openingBalance,
      archivedAt: a.archivedAt,
      sortOrder: a.sortOrder,
      delta: balanceDelta,
      operations: sql<number>`count(${t.id})::int`,
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
  const [row] = await getDb()
    .insert(financialAccounts)
    .values({ ...input, householdId: ctx.householdId, currency: ctx.currency, sortOrder: 100 })
    .returning()
  await audit({ action: "account.create", entityType: "account", entityId: row!.id, householdId: ctx.householdId, actorId: ctx.userId, meta: { name: input.name } })
  return row!
}

export async function updateAccount(ctx: HouseholdCtx, id: string, raw: z.input<typeof accountInput>) {
  assertCan(ctx, "catalog.manage")
  const input = accountInput.parse(raw)
  const db = getDb()
  const [before] = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.id, uuid.parse(id)), eq(financialAccounts.householdId, ctx.householdId)))
  if (!before) throw notFound("Счёт не найден")
  await db.update(financialAccounts).set(input).where(eq(financialAccounts.id, id))
  await audit({ action: "account.update", entityType: "account", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: diff(before, input) })
}

export async function setAccountArchived(ctx: HouseholdCtx, id: string, archived: boolean) {
  assertCan(ctx, "catalog.manage")
  uuid.parse(id)
  const db = getDb()
  if (archived) {
    const [active] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(financialAccounts)
      .where(and(eq(financialAccounts.householdId, ctx.householdId), isNull(financialAccounts.archivedAt)))
    if ((active?.n ?? 0) <= 1) throw new AppError("Нельзя архивировать единственный активный счёт")
  }
  const res = await db
    .update(financialAccounts)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(financialAccounts.id, id), eq(financialAccounts.householdId, ctx.householdId)))
    .returning()
  if (res.length === 0) throw notFound("Счёт не найден")
  await audit({ action: archived ? "account.archive" : "account.restore", entityType: "account", entityId: id, householdId: ctx.householdId, actorId: ctx.userId })
}

export async function deleteAccount(ctx: HouseholdCtx, id: string) {
  assertCan(ctx, "catalog.manage")
  uuid.parse(id)
  const db = getDb()
  const [used] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), or(eq(transactions.accountId, id), eq(transactions.toAccountId, id))))
  const [usedByRules] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(recurringRules)
    .where(and(eq(recurringRules.householdId, ctx.householdId), or(eq(recurringRules.accountId, id), eq(recurringRules.toAccountId, id))))
  if ((used?.n ?? 0) > 0 || (usedByRules?.n ?? 0) > 0) {
    throw new AppError("По счёту есть операции. Архивируйте его — история сохранится.")
  }
  const [active] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(financialAccounts)
    .where(and(eq(financialAccounts.householdId, ctx.householdId), isNull(financialAccounts.archivedAt)))
  if ((active?.n ?? 0) <= 1) throw new AppError("Нельзя удалить единственный счёт")
  const res = await db
    .delete(financialAccounts)
    .where(and(eq(financialAccounts.id, id), eq(financialAccounts.householdId, ctx.householdId)))
    .returning()
  if (res.length === 0) throw notFound("Счёт не найден")
  await audit({ action: "account.delete", entityType: "account", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: { name: res[0]!.name } })
}
