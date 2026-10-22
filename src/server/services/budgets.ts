import "server-only"
import { and, asc, eq, isNull } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { categories, categoryBudgets } from "@/db/schema"
import { endOfMonth, todayIn, type IsoDate } from "@/lib/dates"
import { audit } from "../audit"
import { assertCan, type HouseholdCtx } from "../context"
import { notFound } from "../errors"
import { loadFinance } from "./finance-data"
import { virtualOccurrences } from "./recurring"

export async function getBudgetReport(ctx: HouseholdCtx, monthStart: IsoDate) {
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

  const data = await loadFinance(ctx)
  const byCat = new Map<string | null, { spent: number; planned: number }>()
  for (const r of data.rows) {
    if (r.type !== "expense" || r.date < monthStart || r.date > monthEnd) continue
    const cur = byCat.get(r.categoryId) ?? { spent: 0, planned: 0 }
    if (r.status === "posted") cur.spent += data.value(r)
    else cur.planned += data.value(r)
    byCat.set(r.categoryId, cur)
  }
  for (const v of await virtualOccurrences(ctx, monthStart, monthEnd, todayIn(ctx.timezone))) {
    if (v.type !== "expense" || !v.categoryId) continue
    const cur = byCat.get(v.categoryId) ?? { spent: 0, planned: 0 }
    cur.planned += data.value(v)
    byCat.set(v.categoryId, cur)
  }

  const rows = cats.map((c) => {
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
  return { rows, warnings: [...data.fx.warnings] }
}

export async function getBudgets(ctx: HouseholdCtx, monthStart: IsoDate) {
  return (await getBudgetReport(ctx, monthStart)).rows
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
