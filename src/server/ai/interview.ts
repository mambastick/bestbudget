import "server-only"
import { randomUUID } from "node:crypto"
import { sumMoney } from "@/domain/goals"
import { fingerprint } from "./config"
import { z } from "zod"
import { categoryInput, listAccounts, listCategories } from "@/server/services/catalog"
import { budgetInput, getBudgetReport } from "@/server/services/budgets"
import { ruleInput, listRules } from "@/server/services/recurring"
import { goalInput, listGoals, newAutomatedGoalInput, previewNewGoalAutomation, previewGoalAutomation } from "@/server/services/goals"
import { previewRecurringProjection } from "@/server/services/reports"
import { assertCan, type HouseholdCtx } from "@/server/context"
import { AppError } from "@/server/errors"
import { addMonths, endOfMonth, startOfMonth, todayIn } from "@/lib/dates"
import { createConversation, listConversations, conversationMessages, getConversation } from "./conversations"
import { requireAi } from "./access"
import { listProposals } from "./proposals"

const plannedRule = z.object({
  id: z.uuid().optional(),
  categoryName: categoryInput.shape.name,
  rule: ruleInput.safeExtend({ categoryId: z.null().optional() }),
})
export const budgetPlanInput = z
  .object({
    title: z.string().trim().min(1).max(120),
    categories: z.array(categoryInput).max(20).default([]),
    recurring: z.array(plannedRule).max(20).default([]),
    budgets: z
      .array(z.object({ categoryName: categoryInput.shape.name, amount: budgetInput.shape.amount }))
      .max(20)
      .default([]),
    goals: z
      .array(z.object({ id: z.uuid().optional(), goal: goalInput, automation: newAutomatedGoalInput.shape.automation.optional() }))
      .max(10)
      .default([]),
  })
  .refine((input) => input.categories.length + input.recurring.length + input.budgets.length + input.goals.length <= 20)
export async function requireInterview(ctx: HouseholdCtx, conversationId: string) {
  assertCan(ctx, "catalog.manage")
  if ((await getConversation(ctx, conversationId)).kind !== "onboarding") throw new AppError("ai.invalidProposal")
}
const key = (kind: string, name: string) => `${kind}:${name.trim().toLowerCase()}`

/** Resolve known entities server-side so a repeated interview produces updates instead of duplicates. */
export async function prepareBudgetPlan(ctx: HouseholdCtx, raw: z.input<typeof budgetPlanInput>) {
  assertCan(ctx, "catalog.manage")
  const input = budgetPlanInput.parse(raw)
  const [cats, rules, goals, accounts, budgets] = await Promise.all([
    listCategories(ctx),
    listRules(ctx),
    listGoals(ctx),
    listAccounts(ctx),
    getBudgetReport(ctx, startOfMonth(todayIn(ctx.timezone)), ctx.locale),
  ])
  const items: { type: string; input: unknown; dependsOn?: number[] }[] = []
  const pendingCategories = new Map<string, { input: z.output<typeof categoryInput>; index: number }>()
  const categoriesByName = new Map(cats.map((cat) => [key(cat.kind, cat.name), cat]))
  for (const category of input.categories) {
    const k = key(category.kind, category.name)
    if (categoriesByName.has(k)) continue
    if (pendingCategories.has(k)) throw new AppError("ai.invalidProposal")
    pendingCategories.set(k, { input: category, index: items.length })
    items.push({ type: "category.create", input: category })
  }
  const seenRules = new Set<string>(),
    seenBudgets = new Set<string>(),
    seenGoals = new Set<string>()
  const automatedAccounts = new Set<string>()
  const proposed: { id?: string; rule: z.input<typeof ruleInput>; categoryName: string }[] = []
  for (const entry of input.recurring) {
    const identity =
      entry.id ??
      `${entry.rule.type}:${entry.rule.accountId}:${entry.rule.title}:${entry.rule.frequency}:${entry.rule.dayOfMonth ?? entry.rule.startDate}`
    if (seenRules.has(identity)) throw new AppError("ai.invalidProposal")
    seenRules.add(identity)
    const category = categoriesByName.get(key(entry.rule.type, entry.categoryName))
    const pending = pendingCategories.get(key(entry.rule.type, entry.categoryName))
    if ((!category && !pending) || entry.rule.type === "transfer") throw new AppError("ai.invalidProposal")
    const account = accounts.find((a) => a.id === entry.rule.accountId && a.kind !== "loan")
    if (!account) throw new AppError("ai.invalidProposal")
    const matches = rules.filter(({ rule }) =>
      entry.id
        ? rule.id === entry.id
        : !rule.goalId &&
          rule.title === entry.rule.title &&
          rule.type === entry.rule.type &&
          rule.accountId === entry.rule.accountId &&
          rule.dayOfMonth ===
            (["monthly", "yearly"].includes(entry.rule.frequency)
              ? (entry.rule.dayOfMonth ?? Number(entry.rule.startDate.slice(8)))
              : null),
    )
    if (matches.length > 1 || (entry.id && !matches.length)) throw new AppError("ai.invalidProposal")
    const before = matches[0]?.rule
    const rule = { ...entry.rule, categoryId: category?.id, description: before?.description ?? null }
    proposed.push({ id: before?.id, rule, categoryName: entry.categoryName })
    if (before) {
      if (!category) throw new AppError("ai.invalidProposal")
      items.push({ type: "recurring.update", input: { id: before.id, version: before.version, rule } })
    } else if (category) items.push({ type: "recurring.create", input: rule })
    else items.push({ type: "recurring.planned", input: { category: pending!.input, rule: entry.rule }, dependsOn: [pending!.index] })
  }
  const limits = new Map(budgets.rows.map((row) => [key("expense", row.name), row.limit ?? 0]))
  for (const entry of input.budgets) {
    const k = key("expense", entry.categoryName)
    if (seenBudgets.has(k)) throw new AppError("ai.invalidProposal")
    seenBudgets.add(k)
    const category = categoriesByName.get(k),
      pending = pendingCategories.get(k)
    if (!category && !pending) throw new AppError("ai.invalidProposal")
    limits.set(k, entry.amount ?? 0)
    items.push(
      category
        ? { type: "budget.set", input: { categoryId: category.id, amount: entry.amount } }
        : { type: "budget.planned", input: { category: pending!.input, amount: entry.amount }, dependsOn: [pending!.index] },
    )
  }
  const warnings: string[] = []
  const addTopup = (preview: {
    amount: number
    toAmount: number
    startDate: string
    endDate: string | null
    accountId: string
    toAccountId: string | null
    day: number
  }) => {
    proposed.push({
      categoryName: "",
      rule: {
        type: "transfer",
        title: "Goal top-up",
        amount: preview.amount,
        toAmount: preview.toAmount,
        accountId: preview.accountId,
        toAccountId: preview.toAccountId,
        frequency: "monthly",
        dayOfMonth: preview.day,
        startDate: preview.startDate,
        endDate: preview.endDate,
      },
    })
  }
  for (const entry of input.goals) {
    const identity = entry.id ?? key("goal", entry.goal.name)
    if (seenGoals.has(identity)) throw new AppError("ai.invalidProposal")
    seenGoals.add(identity)
    const matches = goals.goals.filter((goal) =>
      entry.id ? goal.id === entry.id : key("goal", goal.name) === key("goal", entry.goal.name),
    )
    if (matches.length > 1 || (entry.id && !matches.length)) throw new AppError("ai.invalidProposal")
    const before = matches[0]
    if (before) {
      if (entry.automation && !before.automation && fingerprint(goalInput.parse(before)) === fingerprint(entry.goal)) {
        const preview = await previewGoalAutomation(ctx, before.id, { ...entry.automation, version: before.version })
        addTopup({
          ...preview,
          accountId: entry.automation.accountId,
          toAccountId: before.accountId,
          endDate: before.targetDate,
          day: entry.automation.day,
        })
        items.push({ type: "goal.automate", input: { ...entry.automation, id: before.id, version: before.version } })
      } else {
        items.push({ type: "goal.update", input: { ...entry.goal, id: before.id, version: before.version } })
        if (entry.automation && !before.automation)
          warnings.push("Update the existing goal first, then request its automatic top-up separately.")
      }
    } else if (entry.automation) {
      // The same preview is captured by the registered handler and checked again before application.
      if (automatedAccounts.has(entry.goal.accountId!)) throw new AppError("ai.invalidProposal")
      automatedAccounts.add(entry.goal.accountId!)
      const plannedId = randomUUID()
      const preview = await previewNewGoalAutomation(ctx, { plannedId, goal: entry.goal, automation: entry.automation })
      addTopup(preview)
      items.push({ type: "goal.create_automated", input: { plannedId, goal: entry.goal, automation: entry.automation } })
    } else items.push({ type: "goal.create", input: entry.goal })
  }
  if (!items.length) throw new AppError("ai.invalidProposal")
  const today = todayIn(ctx.timezone),
    month = startOfMonth(addMonths(today, 1))
  const forecast = await previewRecurringProjection(ctx, proposed, endOfMonth(month))
  if (forecast.days.some((day) => !Number.isSafeInteger(day.balance))) throw new AppError("ai.invalidProposal")
  const nextMonth = forecast.flows.filter((flow) => flow.date >= month && flow.date <= endOfMonth(month))
  const income = sumMoney(nextMonth.filter((flow) => flow.type === "income").map((flow) => flow.amount))
  const mandatory = sumMoney(nextMonth.filter((flow) => flow.type === "expense").map((flow) => flow.amount))
  const monthlyLimits = [...limits.values()].reduce((sum, amount) => sum + amount, 0)
  const variable = [...limits].reduce((sum, [k, limit]) => {
    const category = categoriesByName.get(k)
    const scheduled = nextMonth
      .filter((flow) => flow.type === "expense" && category && flow.categoryId === category.id)
      .reduce((total, flow) => total + flow.amount, 0)
    // Proposed new-category rules have no persistent ID yet, so attribute them by name.
    const pendingScheduled = category
      ? 0
      : nextMonth
          .filter((flow) => flow.type === "expense" && flow.previewCategory && key("expense", flow.previewCategory) === k)
          .reduce((total, flow) => total + flow.amount, 0)
    return sum + Math.max(0, limit - scheduled - pendingScheduled)
  }, 0)
  const savings = sumMoney(nextMonth.filter((flow) => flow.savings).map((flow) => flow.amount))
  return {
    items,
    summary: {
      currency: ctx.currency,
      month,
      income,
      mandatory,
      monthlyLimits,
      variableAllowance: variable,
      savings,
      remaining: sumMoney([income, -mandatory, -variable, -savings]),
      cashGaps: forecast.days.filter((day) => day.balance < 0).slice(0, 5),
      warnings: [...forecast.warnings, ...warnings],
      forecastScope:
        "Scheduled cash flows only. Category limits are ceilings, not additional scheduled payments. Remaining subtracts unscheduled variable allowance and savings; limits overlapping scheduled expenses are not double counted.",
    },
  }
}

export async function startBudgetInterview(ctx: HouseholdCtx) {
  const { view, ctx: fresh } = await requireAi(ctx)
  assertCan(fresh, "catalog.manage")
  for (const entry of await listConversations(ctx)) {
    if (entry.kind !== "onboarding") continue
    const conversation = await getConversation(ctx, entry.id)
    if (conversation.consentFingerprint !== fingerprint(view.provider) || conversation.dataLevel !== view.dataLevel) continue
    const proposals = await listProposals(ctx, entry.id)
    if (!proposals.length || proposals.some((p) => ["pending", "partially_applied"].includes(p.status) && p.expiresAt > new Date()))
      return { id: entry.id, empty: !(await conversationMessages(ctx, entry.id)).length }
  }
  const conversation = await createConversation(ctx, "onboarding")
  return { id: conversation.id, empty: true }
}
