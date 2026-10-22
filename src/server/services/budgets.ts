import "server-only"
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { categories, categoryBudgets, transactions } from "@/db/schema"
import { endOfMonth, todayIn, type IsoDate } from "@/lib/dates"
import { audit } from "../audit"
import { assertCan, type HouseholdCtx } from "../context"
import { notFound } from "../errors"
import { virtualOccurrences } from "./recurring"

export async function getBudgets(ctx: HouseholdCtx, monthStart: IsoDate) {
  assertCan(ctx, "finance.read")
  const monthEnd = endOfMonth(monthStart)
  const db = getDb()
  const cats = await db
    .select({
      id: categories.id,
      name: categories.name,
      icon: categories.icon,
      color: categories.color,
      limit: categoryBudgets.amount,
    })
    .from(categories)
    .leftJoin(categoryBudgets, eq(categoryBudgets.categoryId, categories.id))
    .where(and(eq(categories.householdId, ctx.householdId), eq(categories.kind, "expense"), isNull(categories.archivedAt)))
    .orderBy(asc(categories.sortOrder), asc(categories.name))

  const sums = await db
    .select({
      categoryId: transactions.categoryId,
      spent: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.status} = 'posted'), 0)`,
      planned: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.status} = 'planned'), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, ctx.householdId),
        eq(transactions.type, "expense"),
        gte(transactions.date, monthStart),
        lte(transactions.date, monthEnd),
      ),
    )
    .groupBy(transactions.categoryId)
  const byCat = new Map(sums.map((s) => [s.categoryId, { spent: Number(s.spent), planned: Number(s.planned) }]))
  for (const v of await virtualOccurrences(ctx, monthStart, monthEnd, todayIn(ctx.timezone))) {
    if (v.type !== "expense" || !v.categoryId) continue
    const cur = byCat.get(v.categoryId) ?? { spent: 0, planned: 0 }
    cur.planned += v.amount
    byCat.set(v.categoryId, cur)
  }

  return cats.map((c) => {
    const s = byCat.get(c.id) ?? { spent: 0, planned: 0 }
    const limit = c.limit ?? null
    return {
      ...c,
      limit,
      spent: s.spent,
      planned: s.planned,
      remaining: limit === null ? null : limit - s.spent,
      percent: limit ? Math.round((s.spent / limit) * 100) : null,
    }
  })
}

export const budgetInput = z.object({
  categoryId: z.uuid(),
  /** Monthly limit in minor units; null removes the limit. */
  amount: z.number().int().positive("Лимит должен быть больше нуля").safe().nullable(),
})

export async function setBudget(ctx: HouseholdCtx, raw: z.input<typeof budgetInput>) {
  assertCan(ctx, "catalog.manage")
  const input = budgetInput.parse(raw)
  const db = getDb()
  const [cat] = await db
    .select({ id: categories.id, kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.id, input.categoryId), eq(categories.householdId, ctx.householdId)))
  if (!cat || cat.kind !== "expense") throw notFound("Категория не найдена")
  if (input.amount === null) {
    await db.delete(categoryBudgets).where(and(eq(categoryBudgets.householdId, ctx.householdId), eq(categoryBudgets.categoryId, input.categoryId)))
  } else {
    await db
      .insert(categoryBudgets)
      .values({ householdId: ctx.householdId, categoryId: input.categoryId, amount: input.amount, updatedBy: ctx.userId })
      .onConflictDoUpdate({
        target: [categoryBudgets.householdId, categoryBudgets.categoryId],
        set: { amount: input.amount, updatedBy: ctx.userId },
      })
  }
  await audit({ action: "budget.set", entityType: "category", entityId: input.categoryId, householdId: ctx.householdId, actorId: ctx.userId, meta: { amount: input.amount } })
}
