import "server-only"
import { and, eq, sql, isNull } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { categories } from "@/db/schema"
import type { HouseholdCtx } from "@/server/context"
import { conflict, notFound } from "@/server/errors"
import { categoryInput } from "./catalog"
import { budgetInput, setBudget } from "./budgets"
import { createRules, ruleInput } from "./recurring"

export const namedRuleInput = z.object({ category: categoryInput, rule: ruleInput.safeExtend({ categoryId: z.null().optional() }) })
export const namedBudgetInput = z.object({ category: categoryInput, amount: budgetInput.shape.amount })

/** Predict only stable category fields; a selected category dependency supplies its actual ID on apply. */
export async function plannedCategorySnapshot(ctx: HouseholdCtx, input: z.output<typeof categoryInput>, lock: boolean) {
  const query = getDb()
    .select({
      name: categories.name,
      kind: categories.kind,
      icon: categories.icon,
      color: categories.color,
      version: categories.version,
      archivedAt: categories.archivedAt,
    })
    .from(categories)
    .where(
      and(
        eq(categories.householdId, ctx.householdId),
        eq(categories.kind, input.kind),
        isNull(categories.archivedAt),
        sql`lower(${categories.name}) = lower(${input.name})`,
      ),
    )
  const rows = await (lock ? query.for("update") : query)
  if (rows.length > 1) throw conflict()
  return rows[0] ?? { ...input, version: 1, archivedAt: null }
}
async function dependencyCategory(ctx: HouseholdCtx, input: z.output<typeof categoryInput>, id: string) {
  const [category] = await getDb()
    .select()
    .from(categories)
    .where(and(eq(categories.householdId, ctx.householdId), eq(categories.id, id)))
  if (!category || category.archivedAt || category.name !== input.name || category.kind !== input.kind) throw notFound("category.notFound")
  return category
}
export async function createNamedRule(ctx: HouseholdCtx, raw: z.input<typeof namedRuleInput>, categoryId: string) {
  const input = namedRuleInput.parse(raw)
  await dependencyCategory(ctx, input.category, categoryId)
  return (await createRules(ctx, { rule: { ...input.rule, categoryId } }, undefined, ctx.locale))[0]!
}
export async function setNamedBudget(ctx: HouseholdCtx, raw: z.input<typeof namedBudgetInput>, categoryId: string) {
  const input = namedBudgetInput.parse(raw)
  await dependencyCategory(ctx, input.category, categoryId)
  return setBudget(ctx, { categoryId, amount: input.amount })
}
