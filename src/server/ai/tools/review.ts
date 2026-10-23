import "server-only"
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { aiProposals, aiReviews, categories, financialAccounts, goals, loans, recurringRules } from "@/db/schema"
import { reviewOutput } from "@/domain/ai/review"
import { addDays, startOfMonth, todayIn } from "@/lib/dates"
import { projection } from "@/server/services/reports"
import { AppError, notFound } from "@/server/errors"
import { spending } from "./read"
import { registerTool, toolRegistry } from "./registry"

registerTool({
  name: "get_review_period",
  conversationKinds: ["review"],
  kind: "read",
  description:
    "Review data: last 30 days versus the preceding 30, current monthly budgets, recurring rules, goals, loans and 90-day cash gaps. No transaction descriptions. Integer minor currency units. Use individual read tools to narrow large results.",
  inputSchema: z.object({}),
  async execute(_, context) {
    const { ctx } = context
    const today = todayIn(ctx.timezone),
      from = addDays(today, -29)
    const read = (name: string, input: unknown = {}) => toolRegistry.get(name)!.execute(input, context)
    const forecast = await projection(ctx, today, addDays(today, 90), today, ctx.locale)
    return {
      forecast: {
        currency: ctx.currency,
        minimumBalance: forecast.days.reduce((min, day) => Math.min(min, day.balance), Number.MAX_SAFE_INTEGER),
        endBalance: forecast.days.at(-1)?.balance ?? 0,
        cashGaps: forecast.days.filter((d) => d.balance < 0).slice(0, 10),
        warnings: forecast.warnings,
      },
      period: {
        from,
        to: today,
        previousFrom: addDays(from, -30),
        previousTo: addDays(from, -1),
        budgetMonth: startOfMonth(today),
      },
      actual: await spending(ctx, { from, to: today }, "expense"),
      previous: await spending(ctx, { from: addDays(from, -30), to: addDays(from, -1) }, "expense"),
      income: await spending(ctx, { from, to: today }, "income"),
      overview: await read("get_overview"),
      accounts: await read("list_accounts"),
      recurring: await read("list_recurring"),
      goals: await read("list_goals"),
      loans: await read("list_loans"),
      uncertainty:
        "Subscription use cannot be proved by payment history. Discuss suspected duplicates; never invent usage data. Loan prepayments require the human loan simulator and available cash after obligations.",
    }
  },
})

registerTool({
  name: "submit_budget_review",
  conversationKinds: ["review"],
  kind: "propose",
  description:
    "Finish a running budget review with structured insights. Give 1–3 sentences with figures and importance. Attach only pending proposal IDs produced in this review. For insight-only recommendations use an existing household category/rule/goal/loan ID, or the household ID for cash gaps. Never applies changes.",
  inputSchema: reviewOutput,
  async execute(input, { ctx, conversationId, messageId }) {
    const [review] = await getDb()
      .select()
      .from(aiReviews)
      .where(
        and(
          eq(aiReviews.householdId, ctx.householdId),
          eq(aiReviews.conversationId, conversationId),
          eq(aiReviews.status, "running"),
        ),
      )
    if (!review) throw notFound()
    const ids = input.insights.flatMap((i) => i.proposalIds)
    if (new Set(ids).size !== ids.length) throw new AppError("ai.invalidProposal")
    const proposals = ids.length
      ? await getDb()
          .select()
          .from(aiProposals)
          .where(
            and(
              eq(aiProposals.householdId, ctx.householdId),
              eq(aiProposals.conversationId, conversationId),
              eq(aiProposals.messageId, messageId),
              eq(aiProposals.status, "pending"),
              inArray(aiProposals.id, ids),
            ),
          )
      : []
    if (proposals.length !== ids.length) throw new AppError("ai.invalidProposal")
    for (const insight of input.insights) {
      const table = {
        budget: categories,
        category_growth: categories,
        recurring: recurringRules,
        subscription: recurringRules,
        goal: goals,
        loan: loans,
        cash_gap: financialAccounts,
      }[insight.type]
      if (insight.type === "cash_gap" && insight.entityId === ctx.householdId) continue
      const [entity] = await getDb()
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.householdId, ctx.householdId), eq(table.id, insight.entityId)))
      if (!entity) throw notFound()
    }
    await getDb()
      .update(aiReviews)
      .set({ output: input })
      .where(and(eq(aiReviews.id, review.id), eq(aiReviews.householdId, ctx.householdId), eq(aiReviews.status, "running")))
    return {
      status: "prepared",
      insights: input.insights.length,
      instruction: "Review saved for human approval. Do not call more tools.",
    }
  },
})
