import "server-only"
import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { getDb, withDb } from "@/db"
import { aiConversations, aiHouseholdSettings, aiProposals, householdMembers, households, aiSettings } from "@/db/schema"
import { can } from "@/domain/permissions"
import type { ProposalItem } from "@/domain/ai/types"
import { audit, withAiAudit } from "@/server/audit"
import type { HouseholdCtx } from "@/server/context"
import { AppError, conflict, forbidden, notFound } from "@/server/errors"
import { requireAi } from "./access"
import { getConversation } from "./conversations"
import { fingerprint } from "./config"
import { proposalExpiry, proposalHandlers } from "./proposal-registry"

export async function createProposal(
  ctx: HouseholdCtx,
  conversationId: string,
  messageId: string,
  raw: { title: string; items: { type: string; input: unknown }[] },
) {
  raw = z
    .object({
      title: z.string().trim().min(1).max(120),
      items: z
        .array(z.object({ type: z.string().min(1).max(100), input: z.unknown() }))
        .min(1)
        .max(20),
    })
    .parse(raw)
  const { view } = await requireAi(ctx)
  const [conversation] = await getDb()
    .select()
    .from(aiConversations)
    .where(
      and(eq(aiConversations.id, conversationId), eq(aiConversations.householdId, ctx.householdId), eq(aiConversations.userId, ctx.userId)),
    )
  if (!conversation) throw notFound()
  if (conversation.consentFingerprint !== fingerprint(view.provider) || conversation.dataLevel !== view.dataLevel)
    throw new AppError("ai.consentChanged")
  const items: ProposalItem[] = []
  const targets = new Set<string>()
  for (const item of raw.items) {
    const handler = proposalHandlers.get(item.type)
    if (!handler) throw new AppError("ai.invalidProposal")
    if (item.type === "transaction.recategorize" && view.dataLevel !== "detailed") throw forbidden()
    const input = handler.schema.parse(item.input)
    const data = input as Record<string, unknown>
    const target =
      typeof data.id === "string"
        ? `${item.type.split(".")[0]}:${data.id}`
        : item.type === "budget.set"
          ? `budget:${data.categoryId}`
          : null
    if (target && targets.has(target)) throw new AppError("ai.invalidProposal")
    if (target) targets.add(target)
    const before = await handler.snapshot(ctx, input)
    const after = handler.after(ctx, input, before)
    let label = String(after.name ?? after.title ?? before?.name ?? before?.title ?? "")
    if (typeof after.categoryId === "string") {
      const { listCategories } = await import("@/server/services/catalog")
      label = (await listCategories(ctx, { includeArchived: true })).find((c) => c.id === after.categoryId)?.name ?? label
    }
    const accounts = z
      .array(z.object({ id: z.uuid(), currency: z.string() }))
      .parse((before?.references as Record<string, unknown> | undefined)?.accounts ?? [])
    const accountCurrency = (id: unknown) => accounts.find((account) => account.id === id)?.currency
    const currency =
      typeof after.currency === "string" ? after.currency : (accountCurrency(after.accountId ?? before?.accountId) ?? ctx.currency)
    const beforeCurrency = typeof before?.currency === "string" ? before.currency : (accountCurrency(before?.accountId) ?? ctx.currency)
    const allocationCurrency = accountCurrency(after.accountId ?? before?.accountId)
    const beforeAllocationCurrency = accountCurrency(before?.accountId)
    items.push({
      id: randomUUID(),
      type: item.type,
      input,
      before,
      after,
      label,
      permission: handler.permission,
      householdCurrency: ctx.currency,
      householdTimezone: ctx.timezone,
      currency,
      beforeCurrency,
      toCurrency: accountCurrency(after.toAccountId ?? before?.toAccountId),
      beforeToCurrency: accountCurrency(before?.toAccountId),
      fieldCurrencies: allocationCurrency ? { allocatedAmount: allocationCurrency } : undefined,
      beforeFieldCurrencies: beforeAllocationCurrency ? { allocatedAmount: beforeAllocationCurrency } : undefined,
    })
  }
  const [proposal] = await getDb()
    .insert(aiProposals)
    .values({ householdId: ctx.householdId, conversationId, messageId, title: raw.title, items, expiresAt: proposalExpiry() })
    .returning()
  return { proposalId: proposal!.id, status: "pending" }
}
export async function listProposals(ctx: HouseholdCtx, conversationId: string) {
  await getConversation(ctx, conversationId)
  return getDb()
    .select()
    .from(aiProposals)
    .where(and(eq(aiProposals.householdId, ctx.householdId), eq(aiProposals.conversationId, conversationId)))
}
export async function applyProposal(ctx: HouseholdCtx, proposalId: string, itemIds: string[]) {
  z.uuid().parse(proposalId)
  const ids = z.array(z.uuid()).min(1).max(20).parse(itemIds)
  if (new Set(ids).size !== ids.length) throw new AppError("ai.invalidProposal")
  await requireAi(ctx)
  return getDb().transaction(async (db) =>
    withDb(db, async () => {
      await db.select().from(households).where(eq(households.id, ctx.householdId)).for("share")
      await db.select().from(aiSettings).where(eq(aiSettings.id, 1)).for("share")
      const [membership] = await db
        .select()
        .from(householdMembers)
        .where(and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.userId, ctx.userId)))
        .for("share")
      if (!membership) throw forbidden()
      let fresh = { ...ctx, role: membership.role }
      // Consent cannot be revoked midway through a financial transaction.
      await db.select().from(aiHouseholdSettings).where(eq(aiHouseholdSettings.householdId, ctx.householdId)).for("share")
      const { view, ctx: current } = await requireAi(fresh)
      fresh = current
      const [proposal] = await db
        .select()
        .from(aiProposals)
        .where(and(eq(aiProposals.id, proposalId), eq(aiProposals.householdId, ctx.householdId)))
        .for("update")
      if (!proposal) throw notFound()
      const [conversation] = await db
        .select()
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.id, proposal.conversationId),
            eq(aiConversations.householdId, ctx.householdId),
            eq(aiConversations.userId, ctx.userId),
          ),
        )
      if (!conversation) throw notFound()
      if (conversation.consentFingerprint !== fingerprint(view.provider) || conversation.dataLevel !== view.dataLevel)
        throw new AppError("ai.consentChanged")
      if (proposal.expiresAt <= new Date()) throw new AppError("ai.expired")
      if (!["pending", "partially_applied", "applied"].includes(proposal.status)) throw new AppError("ai.proposalClosed")
      const selected = proposal.items.filter((item) => ids.includes(item.id))
      if (selected.length !== ids.length) throw new AppError("ai.invalidProposal")
      for (const item of selected) {
        if (item.householdCurrency !== fresh.currency || item.householdTimezone !== fresh.timezone) throw conflict()
        const handler = proposalHandlers.get(item.type)
        if (!handler || !can(fresh.role, handler.permission)) throw forbidden()
        if (item.result) continue
        const now = await handler.snapshot(fresh, item.input, true)
        if (fingerprint(now) !== fingerprint(item.before)) throw conflict()
      }
      const unapplied = selected.filter((item) => !item.result)
      if (!unapplied.length) return { applied: 0 }
      await withAiAudit(proposalId, async () => {
        for (const item of selected) {
          if (!item.result) item.result = await proposalHandlers.get(item.type)!.apply(fresh, item.input, item.before)
        }
        const status = proposal.items.every((item) => item.result) ? "applied" : "partially_applied"
        await db
          .update(aiProposals)
          .set({ items: proposal.items, status, appliedBy: ctx.userId, appliedAt: new Date() })
          .where(eq(aiProposals.id, proposalId))
        await audit(
          {
            action: "ai.proposal.apply",
            entityType: "ai_proposal",
            entityId: proposalId,
            householdId: ctx.householdId,
            actorId: ctx.userId,
            meta: { itemIds: ids },
          },
          db,
        )
      })
      return { applied: unapplied.length }
    }),
  )
}
export async function dismissProposal(ctx: HouseholdCtx, id: string) {
  const [proposal] = await getDb()
    .select({ id: aiProposals.id })
    .from(aiProposals)
    .innerJoin(
      aiConversations,
      and(eq(aiConversations.id, aiProposals.conversationId), eq(aiConversations.householdId, aiProposals.householdId)),
    )
    .where(
      and(eq(aiProposals.id, z.uuid().parse(id)), eq(aiProposals.householdId, ctx.householdId), eq(aiConversations.userId, ctx.userId)),
    )
  if (!proposal) throw notFound()
  await getDb()
    .update(aiProposals)
    .set({ status: "dismissed" })
    .where(and(eq(aiProposals.id, id), eq(aiProposals.householdId, ctx.householdId)))
}
