import "server-only"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { categories, categoryBudgets, goals, recurringRules, transactions } from "@/db/schema"
import type { Permission } from "@/domain/permissions"
import type { HouseholdCtx } from "@/server/context"
import { notFound } from "@/server/errors"
import { todayIn } from "@/lib/dates"
import { budgetInput, setBudget } from "@/server/services/budgets"
import { accountInput, categoryInput, createAccount, createCategory, setCategoryArchived, updateCategory } from "@/server/services/catalog"
import { automateGoal, createGoal, goalInput, previewGoalAutomation, updateGoal } from "@/server/services/goals"
import { categoryRuleInput, saveCategoryRule } from "@/server/services/imports"
import { createRules, ruleInput, ruleUpdateInput, stopRule, updateRule } from "@/server/services/recurring"
import { isoDate, updateTransaction } from "@/server/services/transactions"

export type Snapshot = Record<string, unknown> | null
export interface ProposalHandler {
  schema: z.ZodType
  permission: Permission
  snapshot(ctx: HouseholdCtx, input: unknown, lock?: boolean): Promise<Snapshot>
  after(ctx: HouseholdCtx, input: unknown, before: Snapshot): Record<string, unknown>
  apply(ctx: HouseholdCtx, input: unknown, before: Snapshot): Promise<{ href: string; entityId?: string }>
}
export const proposalHandlers = new Map<string, ProposalHandler>()
export function registerProposal<T>(
  type: string,
  schema: z.ZodType<T>,
  handler: {
    permission: Permission
    snapshot?(ctx: HouseholdCtx, input: NoInfer<T>, lock: boolean): Promise<Snapshot>
    after?(ctx: HouseholdCtx, input: NoInfer<T>, before: Snapshot): Record<string, unknown>
    apply(ctx: HouseholdCtx, input: NoInfer<T>, before: Snapshot): Promise<{ href: string; entityId?: string }>
  },
) {
  if (proposalHandlers.has(type)) throw new Error("DuplicateProposalType")
  proposalHandlers.set(type, {
    schema,
    permission: handler.permission,
    snapshot: (ctx, input, lock = false) => handler.snapshot?.(ctx, schema.parse(input), lock) ?? Promise.resolve(null),
    after: (ctx, input, before) => handler.after?.(ctx, schema.parse(input), before) ?? (schema.parse(input) as Record<string, unknown>),
    apply: (ctx, input, before) => handler.apply(ctx, schema.parse(input), before),
  })
}
const idInput = z.object({ id: z.uuid() })
const automationInput = z.object({ accountId: z.uuid(), day: z.number().int().min(1).max(31), version: z.number().int().positive() })
const goalChangeInput = goalInput.safeExtend({ id: z.uuid(), version: z.number().int().positive() })

async function owned(
  ctx: HouseholdCtx,
  table: typeof categories | typeof goals | typeof recurringRules | typeof transactions,
  id: string,
  lock: boolean,
) {
  const query = getDb()
    .select()
    .from(table)
    .where(and(eq(table.householdId, ctx.householdId), eq(table.id, id)))
  const [row] = await (lock ? query.for("update") : query)
  if (!row) throw notFound()
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>
}
const versioned = (table: Parameters<typeof owned>[1]) => (ctx: HouseholdCtx, input: { id: string }, lock: boolean) =>
  owned(ctx, table, input.id, lock)
registerProposal("budget.set", budgetInput, {
  permission: "catalog.manage",
  async snapshot(ctx, input, lock) {
    await owned(ctx, categories, input.categoryId, lock)
    const query = getDb()
      .select()
      .from(categoryBudgets)
      .where(and(eq(categoryBudgets.householdId, ctx.householdId), eq(categoryBudgets.categoryId, input.categoryId)))
    const [row] = await (lock ? query.for("update") : query)
    return row ? { id: row.id, version: row.version, categoryId: row.categoryId, amount: row.amount } : null
  },
  apply: async (ctx, input) => {
    await setBudget(ctx, input)
    return { href: "/budgets", entityId: input.categoryId }
  },
})
registerProposal("category.create", categoryInput, {
  permission: "catalog.manage",
  apply: async (ctx, input) => ({ href: "/settings?tab=categories", entityId: (await createCategory(ctx, input)).id }),
})
registerProposal("category.rename", categoryInput.omit({ kind: true }).extend(idInput.shape), {
  permission: "catalog.manage",
  snapshot: versioned(categories),
  apply: async (ctx, input) => {
    await updateCategory(ctx, input.id, input)
    return { href: "/settings?tab=categories", entityId: input.id }
  },
})
registerProposal("category.archive", idInput, {
  permission: "catalog.manage",
  snapshot: versioned(categories),
  after: (_ctx, _input, before) => ({ name: before?.name, archived: true }),
  apply: async (ctx, input) => {
    await setCategoryArchived(ctx, input.id, true)
    return { href: "/settings?tab=categories", entityId: input.id }
  },
})
registerProposal("account.create", accountInput, {
  permission: "catalog.manage",
  apply: async (ctx, input) => ({ href: "/accounts", entityId: (await createAccount(ctx, input)).id }),
})
registerProposal("recurring.create", ruleInput, {
  permission: "finance.write",
  apply: async (ctx, input) => ({
    href: "/transactions?tab=rules",
    entityId: (await createRules(ctx, { rule: input }, undefined, ctx.locale))[0]!.id,
  }),
})
registerProposal("recurring.update", ruleUpdateInput.extend(idInput.shape), {
  permission: "finance.write",
  snapshot: versioned(recurringRules),
  after: (_ctx, input) => input.rule,
  apply: async (ctx, input) => {
    await updateRule(ctx, input.id, input, ctx.locale)
    return { href: "/transactions?tab=rules", entityId: input.id }
  },
})
registerProposal("recurring.pause", idInput.extend({ endDate: isoDate }), {
  permission: "finance.write",
  snapshot: versioned(recurringRules),
  after: (_ctx, input, before) => ({ title: before?.title, endDate: input.endDate }),
  apply: async (ctx, input) => {
    await stopRule(ctx, input.id, input.endDate)
    return { href: "/transactions?tab=rules", entityId: input.id }
  },
})
registerProposal("goal.create", goalInput, {
  permission: "finance.write",
  apply: async (ctx, input) => {
    const goal = await createGoal(ctx, input)
    return { href: `/goals/${goal.id}`, entityId: goal.id }
  },
})
registerProposal("goal.update", goalChangeInput, {
  permission: "finance.write",
  snapshot: versioned(goals),
  apply: async (ctx, input) => {
    await updateGoal(ctx, input.id, input)
    return { href: `/goals/${input.id}`, entityId: input.id }
  },
})
registerProposal("goal.automate", automationInput.extend(idInput.shape), {
  permission: "finance.write",
  snapshot: async (ctx, input, lock) => {
    const goal = await owned(ctx, goals, input.id, lock)
    const preview = await previewGoalAutomation(ctx, input.id, input)
    return {
      ...goal,
      automationPreview: {
        amount: preview.amount,
        toAmount: preview.toAmount,
        startDate: preview.startDate,
        endDate: preview.g.targetDate,
        accountId: input.accountId,
        toAccountId: preview.g.accountId,
        day: input.day,
        currency: preview.currency,
      },
    }
  },
  after: (_ctx, _input, before) => before!.automationPreview as Record<string, unknown>,
  apply: async (ctx, input) => {
    await automateGoal(ctx, input.id, input)
    return { href: `/goals/${input.id}`, entityId: input.id }
  },
})
registerProposal("transaction.recategorize", idInput.extend({ categoryId: z.uuid() }), {
  permission: "finance.write",
  snapshot: versioned(transactions),
  after: (_ctx, input, before) => ({ title: before?.title, date: before?.date, amount: before?.amount, categoryId: input.categoryId }),
  apply: async (ctx, input, before) => {
    const parsed = z
      .object({
        type: z.enum(["income", "expense"]),
        status: z.enum(["planned", "posted"]),
        amount: z.number(),
        toAmount: z.number().nullable(),
        title: z.string(),
        description: z.string().nullable(),
        date: isoDate,
        version: z.number(),
        accountId: z.uuid(),
        toAccountId: z.uuid().nullable(),
      })
      .parse(before)
    await updateTransaction(ctx, input.id, { ...parsed, categoryId: input.categoryId }, undefined, ctx.locale)
    return { href: "/transactions", entityId: input.id }
  },
})
registerProposal("import.rule", categoryRuleInput, {
  permission: "finance.write",
  apply: async (ctx, input) => ({ href: "/transactions/import", entityId: await saveCategoryRule(ctx, input) }),
})

export function proposalSchema(types: string[]) {
  const [first, ...rest] = types.map((type) => z.object({ type: z.literal(type), input: proposalHandlers.get(type)!.schema }))
  if (!first) throw new Error("EmptyProposalTypes")
  return z.object({
    title: z.string().trim().min(1).max(120),
    items: z
      .array(z.discriminatedUnion("type", [first, ...rest]))
      .min(1)
      .max(20),
  })
}
export function proposalExpiry() {
  return new Date(Date.now() + 7 * 86400_000)
}
export function defaultPauseDate(ctx: HouseholdCtx) {
  return todayIn(ctx.timezone)
}
