import "server-only"
import { z } from "zod"
import { interviewStepInput } from "@/domain/ai/interview"
import { budgetPlanInput, prepareBudgetPlan, requireInterview } from "../interview"
import { createProposal } from "../proposals"
import { registerTool, toolRegistry } from "./registry"

registerTool({
  name: "get_interview_context",
  kind: "read",
  conversationKinds: ["onboarding"],
  description:
    "Read existing accounts, categories, recurring schedules, budgets, goals and loans before asking budget interview questions. Never re-ask known facts. No transaction descriptions or notes.",
  inputSchema: z.object({}),
  async execute(_, context) {
    await requireInterview(context.ctx, context.conversationId)
    const names = ["list_accounts", "list_categories", "list_recurring", "list_goals", "list_loans", "list_budgets"]
    return Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [
          name,
          await toolRegistry
            .get(name)!
            .execute(name === "list_budgets" ? { month: (await import("@/lib/dates")).todayIn(context.ctx.timezone) } : {}, context),
        ]),
      ),
    )
  },
})
registerTool({
  name: "interview_step",
  kind: "read",
  conversationKinds: ["onboarding"],
  description:
    "Present the current budget interview step with 1–2 questions and up to 6 optional quick replies, localized to the user. Persisted in normal conversation tool messages; no financial changes. Stay on a step until sufficient details are known; users may skip or revise answers.",
  inputSchema: interviewStepInput,
  async execute(input, { ctx, conversationId }) {
    await requireInterview(ctx, conversationId)
    return input
  },
})
registerTool({
  name: "propose_budget_plan",
  kind: "propose",
  conversationKinds: ["onboarding"],
  description:
    "Prepare ONE atomic human-reviewed budget plan after the five interview steps. Includes new categories, income/payment schedules, monthly category limits and goals with optional user-approved automatic top-ups. Reuses existing entities by ID/name; use explicit IDs for edits. Money is integer minor units. categoryName links new categories without invented IDs. Returns a read-only forecast of proposed schedules for the next full month; summarize it before the proposal. Never promise changes before user application.",
  inputSchema: budgetPlanInput,
  async execute(input, { ctx, conversationId, messageId }) {
    await requireInterview(ctx, conversationId)
    const plan = await prepareBudgetPlan(ctx, input)
    return { ...(await createProposal(ctx, conversationId, messageId, { title: input.title, items: plan.items })), summary: plan.summary }
  },
})
