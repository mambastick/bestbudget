import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { getDb } from "@/db"
import {
  aiConversations,
  aiMessages,
  aiSettings,
  aiUsage,
  auditLogs,
  categories,
  categoryBudgets,
  financialAccounts,
  goals,
  householdMembers,
  recurringRules,
  transactions,
} from "@/db/schema"
import { setupHousehold, createUser } from "./helpers"
import { saveAiSettings, getAiConfig, fingerprint, snapshot } from "@/server/ai/config"
import { saveHouseholdAi } from "@/server/ai/access"
import { createConversation, conversationMessages, listConversations, renameConversation } from "@/server/ai/conversations"
import { chatResponse } from "@/server/ai/chat"
import { applyProposal, createProposal, listProposals } from "@/server/ai/proposals"
import { prepareBudgetPlan, startBudgetInterview, type budgetPlanInput } from "@/server/ai/interview"
import { interviewProgress } from "@/domain/ai/interview"
import { toolRegistry, buildTools } from "@/server/ai/tools"
import { createGoal } from "@/server/services/goals"
import { createAccount, updateCategory } from "@/server/services/catalog"
import { createTransaction } from "@/server/services/transactions"
import { createRules } from "@/server/services/recurring"
import { addMonths, todayIn } from "@/lib/dates"
import type { z } from "zod"

const db = getDb()
beforeEach(async () => {
  vi.stubEnv("AI_PROVIDER", "")
  await db.delete(aiSettings)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function fixture() {
  const f = await setupHousehold("Interview synthetic")
  await saveAiSettings(f.owner.id, { provider: "mock", model: "test-budget", enabled: true })
  await saveHouseholdAi(f.ctx, {
    enabled: true,
    consent: true,
    dataLevel: "aggregates",
    providerFingerprint: fingerprint(snapshot((await getAiConfig())!)),
    version: 0,
  })
  const conversation = await createConversation(f.ctx, "onboarding")
  return { ...f, conversation }
}
function plan(f: Awaited<ReturnType<typeof fixture>>): z.input<typeof budgetPlanInput> {
  const startDate = todayIn(f.ctx.timezone)
  return {
    title: "Family plan",
    categories: [{ name: "New category", kind: "expense", icon: "smile", color: "#123456" }],
    recurring: [
      {
        categoryName: "Зарплата",
        rule: {
          type: "income",
          title: "Salary",
          amount: 10000000,
          accountId: f.mainAccount,
          frequency: "monthly",
          dayOfMonth: 5,
          startDate,
        },
      },
      {
        categoryName: "New category",
        rule: {
          type: "expense",
          title: "Family time",
          amount: 100000,
          accountId: f.mainAccount,
          frequency: "monthly",
          dayOfMonth: 28,
          startDate,
        },
      },
    ],
    budgets: [{ categoryName: "New category", amount: 500000 }],
    goals: [{ goal: { name: "Cushion", kind: "manual", currency: "RUB", targetAmount: 30000000 } }],
  }
}
async function proposal(f: Awaited<ReturnType<typeof fixture>>, input = plan(f)) {
  const prepared = await prepareBudgetPlan(f.ctx, input)
  const messageId = randomUUID()
  await db
    .insert(aiMessages)
    .values({ id: messageId, conversationId: f.conversation.id, householdId: f.ctx.householdId, role: "assistant", parts: [] })
  const result = await createProposal(f.ctx, f.conversation.id, messageId, { title: input.title, items: prepared.items })
  return {
    result,
    prepared,
    row: result.proposalId ? (await listProposals(f.ctx, f.conversation.id)).find((p) => p.id === result.proposalId)! : null,
  }
}
describe("AI budget interview", () => {
  it("selects interview/review tools from the stored conversation kind, regardless of caller hints", async () => {
    const f = await fixture()
    const context = { ctx: f.ctx, conversationId: f.conversation.id, messageId: randomUUID(), kind: "review" as const }
    const interviewTools = await buildTools(context)
    expect(interviewTools).toHaveProperty("interview_step")
    expect(interviewTools).not.toHaveProperty("submit_budget_review")
    const review = await createConversation(f.ctx, "review")
    const reviewTools = await buildTools({ ...context, conversationId: review.id, kind: "onboarding" })
    expect(reviewTools).toHaveProperty("submit_budget_review")
    expect(reviewTools).not.toHaveProperty("interview_step")
    const chat = await createConversation(f.ctx)
    const chatTools = await buildTools({ ...context, conversationId: chat.id })
    expect(chatTools).not.toHaveProperty("submit_budget_review")
    expect(chatTools).not.toHaveProperty("interview_step")
  })

  it("localizes legacy interview titles by start date, preserves renames and rejects stale or private edits", async () => {
    vi.setSystemTime(new Date("2026-10-22T23:30:00Z"))
    const f = await fixture()
    await db.update(aiConversations).set({ title: "Аренда: 30 000 ₽ 1-го; кредитов нет" }).where(eq(aiConversations.id, f.conversation.id))
    expect((await listConversations(f.ctx))[0]).toMatchObject({ title: "Составление бюджета · 23 окт.", version: 1 })
    expect((await listConversations({ ...f.ctx, locale: "en" }))[0]!.title).toBe("Budget setup · Oct 23")
    await renameConversation(f.ctx, { id: f.conversation.id, title: "Наш бюджет", version: 1 })
    await expect(renameConversation(f.ctx, { id: f.conversation.id, title: "Stale edit", version: 1 })).rejects.toMatchObject({
      code: "conflict",
    })
    const response = await chatResponse(f.ctx, {
      id: f.conversation.id,
      message: { id: randomUUID(), role: "user", parts: [{ type: "text", text: "Составь бюджет" }] },
    })
    await response.text()
    const renamed = (await listConversations(f.ctx))[0]!
    expect(renamed.title).toBe("Наш бюджет")
    const stranger = await createUser()
    await db.insert(householdMembers).values({ householdId: f.ctx.householdId, userId: stranger.id, role: "admin" })
    await expect(
      renameConversation({ ...f.ctx, userId: stranger.id, role: "admin" }, { id: renamed.id, title: "Private", version: renamed.version }),
    ).rejects.toMatchObject({ code: "not_found" })
    const other = await fixture()
    await expect(renameConversation(other.ctx, { id: renamed.id, title: "Other family", version: renamed.version })).rejects.toMatchObject({
      code: "not_found",
    })
    await renameConversation(f.ctx, { id: renamed.id, title: null, version: renamed.version })
    vi.setSystemTime(new Date("2026-11-05T09:00:00Z"))
    expect((await listConversations(f.ctx))[0]!.title).toBe("Составление бюджета · 23 окт.")
    expect((await listConversations({ ...f.ctx, timezone: "America/Los_Angeles", locale: "en" }))[0]!.title).toBe("Budget setup · Oct 22")
  })

  it("streams five localized steps, persists quick replies and resumes before producing one read-only package", async () => {
    const f = await fixture()
    const send = async (text: string) => {
      const response = await chatResponse(f.ctx, {
        id: f.conversation.id,
        message: { id: randomUUID(), role: "user", parts: [{ type: "text", text }] },
      })
      const stream = await response.text()
      expect(stream).not.toContain('"type":"error"')
      return stream
    }
    const title = (await listConversations(f.ctx))[0]!.title
    await send("Составь бюджет")
    for (const step of ["income", "fixed", "variable", "goals", "preferences"]) {
      const messages = await conversationMessages(f.ctx, f.conversation.id)
      const progress = interviewProgress(messages)!
      expect(progress.step).toBe(step)
      expect(progress.questions.length).toBeLessThanOrEqual(2)
      expect(progress.quickReplies).not.toHaveLength(0)
      await send(progress.quickReplies[0]!)
    }
    expect((await listConversations(f.ctx))[0]!.title).toBe(title)
    const proposals = await listProposals(f.ctx, f.conversation.id)
    expect(proposals).toHaveLength(1)
    expect(proposals[0]!.items.map((item) => item.type)).toEqual(
      expect.arrayContaining(["category.create", "recurring.planned", "budget.planned", "goal.create"]),
    )
    expect(await db.select().from(categoryBudgets).where(eq(categoryBudgets.householdId, f.ctx.householdId))).toHaveLength(0)
    expect(await db.select().from(recurringRules).where(eq(recurringRules.householdId, f.ctx.householdId))).toHaveLength(0)
    expect(await db.select().from(goals).where(eq(goals.householdId, f.ctx.householdId))).toHaveLength(0)
    expect(await db.select().from(aiUsage).where(eq(aiUsage.householdId, f.ctx.householdId))).toHaveLength(6)
  })
  it("applies categories, schedules, limits and goals atomically, checks dependencies and never duplicates a repeated plan", async () => {
    const f = await fixture(),
      p = await proposal(f),
      row = p.row!
    const dependent = row.items.find((item) => item.type === "budget.planned")!
    await expect(applyProposal(f.ctx, row.id, [dependent.id])).rejects.toMatchObject({ messageKey: "ai.invalidProposal" })
    const selected = row.items.map((item) => item.id)
    expect(await applyProposal(f.ctx, row.id, selected.toReversed())).toEqual({ applied: row.items.length })
    expect(await applyProposal(f.ctx, row.id, selected)).toEqual({ applied: 0 })
    expect(await db.select().from(recurringRules).where(eq(recurringRules.householdId, f.ctx.householdId))).toHaveLength(2)
    expect(await db.select().from(categoryBudgets).where(eq(categoryBudgets.householdId, f.ctx.householdId))).toHaveLength(1)
    expect(await db.select().from(goals).where(eq(goals.householdId, f.ctx.householdId))).toHaveLength(1)
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.householdId, f.ctx.householdId))
    expect(
      logs.filter((log) => (log.meta as Record<string, unknown> | null)?.source === "ai").every((log) => log.actorId === f.ctx.userId),
    ).toBe(true)
    expect((await proposal(f)).result).toMatchObject({ status: "unchanged", proposalId: null })
  })
  it("supports applying the category first and its dependent items later, and detects a category edit", async () => {
    const f = await fixture(),
      p = (await proposal(f)).row!
    const category = p.items.find((item) => item.type === "category.create")!
    await applyProposal(f.ctx, p.id, [category.id])
    const fresh = (await listProposals(f.ctx, f.conversation.id))[0]!
    await applyProposal(
      f.ctx,
      p.id,
      fresh.items.filter((item) => !item.result).map((item) => item.id),
    )
    const another = await fixture(),
      p2 = (await proposal(another)).row!
    const cat = p2.items.find((item) => item.type === "category.create")!
    await applyProposal(another.ctx, p2.id, [cat.id])
    const created = (await listProposals(another.ctx, another.conversation.id))[0]!.items.find((item) => item.id === cat.id)!.result!
      .entityId!
    await updateCategory(another.ctx, created, { name: "Renamed", icon: "smile", color: "#123456" })
    await expect(
      applyProposal(
        another.ctx,
        p2.id,
        p2.items.filter((item) => item.id !== cat.id).map((item) => item.id),
      ),
    ).rejects.toBeDefined()
  })
  it("rolls back all earlier financial changes when the goal fails, including materialized operations", async () => {
    const f = await fixture(),
      input = plan(f)
    input.goals = [{ goal: { name: "Invalid savings", kind: "account", accountId: f.mainAccount, currency: "RUB", targetAmount: 100000 } }]
    const p = (await proposal(f, input)).row!
    await expect(
      applyProposal(
        f.ctx,
        p.id,
        p.items.map((item) => item.id),
      ),
    ).rejects.toMatchObject({ messageKey: "goal.activeSavingsAccount" })
    for (const table of [recurringRules, categoryBudgets, goals, transactions])
      expect(await db.select().from(table).where(eq(table.householdId, f.ctx.householdId))).toHaveLength(0)
    expect(
      await db
        .select()
        .from(categories)
        .where(and(eq(categories.householdId, f.ctx.householdId), eq(categories.name, "New category"))),
    ).toHaveLength(0)
  })
  it("rejects member access, downgraded roles and another household's references", async () => {
    const f = await fixture(),
      p = (await proposal(f)).row!,
      member = await createUser()
    await db.insert(householdMembers).values({ householdId: f.ctx.householdId, userId: member.id, role: "member" })
    await expect(createConversation({ ...f.ctx, userId: member.id, role: "member" }, "onboarding")).rejects.toMatchObject({
      code: "forbidden",
    })
    const other = await setupHousehold()
    const input = plan(f)
    input.recurring![0]!.rule.accountId = other.mainAccount
    await expect(prepareBudgetPlan(f.ctx, input)).rejects.toBeDefined()
    await db
      .update(householdMembers)
      .set({ role: "member" })
      .where(and(eq(householdMembers.householdId, f.ctx.householdId), eq(householdMembers.userId, f.ctx.userId)))
    await expect(
      applyProposal(
        f.ctx,
        p.id,
        p.items.map((item) => item.id),
      ),
    ).rejects.toMatchObject({ code: "forbidden" })
  })
  it("projects only explicitly allowed aggregate fields and excludes transaction/recurring descriptions", async () => {
    const f = await fixture()
    await createTransaction(f.ctx, {
      type: "expense",
      status: "posted",
      amount: 100,
      accountId: f.mainAccount,
      categoryId: f.cat("Продукты"),
      date: todayIn(f.ctx.timezone),
      title: "PRIVATE_TITLE",
      description: "PRIVATE_DESCRIPTION",
    })
    await createRules(f.ctx, {
      rule: {
        type: "expense",
        title: "Allowed schedule name",
        description: "PRIVATE_RECURRING_DESCRIPTION",
        amount: 100,
        accountId: f.mainAccount,
        categoryId: f.cat("Продукты"),
        frequency: "monthly",
        startDate: todayIn(f.ctx.timezone),
      },
    })
    const context = await toolRegistry
      .get("get_interview_context")!
      .execute({}, { ctx: f.ctx, conversationId: f.conversation.id, messageId: randomUUID() })
    expect(JSON.stringify(context)).not.toMatch(/PRIVATE_/)
    expect(JSON.stringify(context)).toContain("Allowed schedule name")
    const other = await fixture()
    expect(
      JSON.stringify(
        await toolRegistry
          .get("get_interview_context")!
          .execute({}, { ctx: other.ctx, conversationId: other.conversation.id, messageId: randomUUID() }),
      ),
    ).not.toContain(f.mainAccount)
  })
  it("previews proposed schedules including cash gaps without writing and avoids double counting edited rules", async () => {
    vi.setSystemTime(new Date("2026-10-23T09:00:00Z"))
    const f = await fixture(),
      input = plan(f)
    const first = await prepareBudgetPlan(f.ctx, input)
    expect(first.summary).toMatchObject({ income: 10000000, mandatory: 100000, monthlyLimits: 500000, remaining: 9500000 })
    expect(first.summary.cashGaps.length).toBeGreaterThan(0)
    const p = (await proposal(f)).row!
    await applyProposal(
      f.ctx,
      p.id,
      p.items.map((item) => item.id),
    )
    const next = await prepareBudgetPlan(f.ctx, input)
    expect(next.summary.income).toBe(first.summary.income)
    expect(next.summary.mandatory).toBe(first.summary.mandatory)
  })
  it("resumes an unfinished private interview and starts a new one after application", async () => {
    const f = await fixture()
    expect(await startBudgetInterview(f.ctx)).toMatchObject({ id: f.conversation.id, empty: true })
    const p = (await proposal(f)).row!
    await applyProposal(
      f.ctx,
      p.id,
      p.items.map((item) => item.id),
    )
    expect((await startBudgetInterview(f.ctx)).id).not.toBe(f.conversation.id)
  })
  it("retains posted income when previewing an edit to its recurring schedule", async () => {
    vi.setSystemTime(new Date("2026-10-23T09:00:00Z"))
    const f = await fixture()
    const input = plan(f)
    const p = (await proposal(f)).row!
    await applyProposal(
      f.ctx,
      p.id,
      p.items.map((item) => item.id),
    )
    const [salary] = await db
      .select()
      .from(recurringRules)
      .where(and(eq(recurringRules.householdId, f.ctx.householdId), eq(recurringRules.title, "Salary")))
    await db.insert(transactions).values({
      householdId: f.ctx.householdId,
      type: "income",
      status: "posted",
      title: "Posted salary",
      amount: 1000000,
      date: todayIn(f.ctx.timezone),
      occurrenceDate: addMonths(todayIn(f.ctx.timezone), -1).slice(0, 8) + "05",
      recurringRuleId: salary!.id,
      accountId: f.mainAccount,
      categoryId: salary!.categoryId,
      createdBy: f.ctx.userId,
    })
    const result = await prepareBudgetPlan(f.ctx, input)
    expect(result.summary.cashGaps).toHaveLength(0)
    expect(result.summary.income).toBe(10000000)
  })
  it("does not add a second forecast occurrence for salary already confirmed ahead of schedule", async () => {
    const f = await fixture(),
      input = plan(f),
      p = (await proposal(f)).row!
    await applyProposal(
      f.ctx,
      p.id,
      p.items.map((item) => item.id),
    )
    const [salary] = await db
      .select()
      .from(recurringRules)
      .where(and(eq(recurringRules.householdId, f.ctx.householdId), eq(recurringRules.title, "Salary")))
    const nextMonth = addMonths(todayIn(f.ctx.timezone), 1).slice(0, 7)
    const rows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, f.ctx.householdId), eq(transactions.recurringRuleId, salary!.id)))
    const advance = rows.find((row) => row.occurrenceDate?.startsWith(nextMonth))!
    await db
      .update(transactions)
      .set({ status: "posted", date: todayIn(f.ctx.timezone) })
      .where(eq(transactions.id, advance.id))
    expect((await prepareBudgetPlan(f.ctx, input)).summary.income).toBe(0)
  })
  it("rolls back if an earlier selected goal edit changes a later automatic top-up amount", async () => {
    const f = await fixture(),
      savings = await createAccount(f.ctx, { name: "Savings", kind: "savings", currency: "RUB", openingBalance: 0 })
    const base = {
      kind: "account" as const,
      accountId: savings.id,
      currency: "RUB" as const,
      targetDate: addMonths(todayIn(f.ctx.timezone), 12),
    }
    const first = await createGoal(f.ctx, { ...base, name: "First", priority: 1, targetAmount: 1000000 })
    const second = await createGoal(f.ctx, { ...base, name: "Second", priority: 2, targetAmount: 2000000 })
    const messageId = randomUUID()
    await db
      .insert(aiMessages)
      .values({ id: messageId, conversationId: f.conversation.id, householdId: f.ctx.householdId, role: "assistant", parts: [] })
    const p = await createProposal(f.ctx, f.conversation.id, messageId, {
      title: "Shared savings",
      items: [
        { type: "goal.update", input: { ...first, targetAmount: 3000000 } },
        { type: "goal.automate", input: { id: second.id, version: second.version, accountId: f.mainAccount, day: 10 } },
      ],
    })
    const row = (await listProposals(f.ctx, f.conversation.id)).find((row) => row.id === p.proposalId)!
    await expect(
      applyProposal(
        f.ctx,
        row.id,
        row.items.map((item) => item.id),
      ),
    ).rejects.toMatchObject({ code: "conflict" })
    expect((await db.select().from(goals).where(eq(goals.id, first.id)))[0]!.targetAmount).toBe(1000000)
    expect(await db.select().from(recurringRules).where(eq(recurringRules.householdId, f.ctx.householdId))).toHaveLength(0)
  })
  it("previews and atomically creates an explicitly requested automatic goal with visible amount and dates", async () => {
    const f = await fixture(),
      savings = await createAccount(f.ctx, { name: "Savings", kind: "savings", currency: "RUB", openingBalance: 0 })
    const input = plan(f)
    input.goals = [
      {
        goal: {
          name: "Automated cushion",
          kind: "account",
          accountId: savings.id,
          currency: "RUB",
          targetAmount: 30000000,
          targetDate: addMonths(todayIn(f.ctx.timezone), 12),
        },
        automation: { accountId: f.mainAccount, day: 10 },
      },
    ]
    const p = (await proposal(f, input)).row!,
      goal = p.items.find((item) => item.type === "goal.create_automated")!
    expect(goal.after.topupAmount).toBeGreaterThan(0)
    expect(goal.after.startDate).toBeDefined()
    expect(await db.select().from(goals).where(eq(goals.householdId, f.ctx.householdId))).toHaveLength(0)
    await applyProposal(
      f.ctx,
      p.id,
      p.items.map((item) => item.id),
    )
    const [created] = await db.select().from(goals).where(eq(goals.householdId, f.ctx.householdId))
    expect(
      await db
        .select()
        .from(recurringRules)
        .where(and(eq(recurringRules.householdId, f.ctx.householdId), eq(recurringRules.goalId, created!.id))),
    ).toHaveLength(1)
    expect((await db.select().from(financialAccounts).where(eq(financialAccounts.id, savings.id)))[0]!.openingBalance).toBe(0)
  })
})
