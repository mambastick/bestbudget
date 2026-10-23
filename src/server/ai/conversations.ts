import "server-only"
import { randomUUID } from "node:crypto"
import { and, asc, desc, eq, gte, gt, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm"
import { z } from "zod"
import { interviewConversationTitle } from "@/domain/ai/conversation-title"
import { assertCan } from "@/server/context"
import type { UIMessage } from "ai"
import { getDb, withDb } from "@/db"
import { aiConversations, aiHouseholdSettings, aiMessages, aiUsage, households, users } from "@/db/schema"
import { AI_RESERVATION_GRACE_MS, AI_TURN_RESERVATION } from "@/domain/ai/types"
import type { HouseholdCtx } from "@/server/context"
import { AppError, conflict, notFound } from "@/server/errors"
import { requireAi } from "./access"
import { fingerprint } from "./config"

export async function listConversations(ctx: HouseholdCtx) {
  const rows = await getDb()
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      kind: aiConversations.kind,
      createdAt: aiConversations.createdAt,
      customTitle: aiConversations.customTitle,
      version: aiConversations.version,
    })
    .from(aiConversations)
    .where(and(eq(aiConversations.householdId, ctx.householdId), eq(aiConversations.userId, ctx.userId), ne(aiConversations.kind, "review")))
    .orderBy(desc(aiConversations.createdAt))
    .limit(100)
  return rows.map(({ createdAt, customTitle, ...row }) => ({
    ...row,
    title: customTitle ?? (row.kind === "onboarding" ? interviewConversationTitle(createdAt, ctx.timezone, ctx.locale) : row.title),
  }))
}
export async function createConversation(ctx: HouseholdCtx, kind: "chat" | "onboarding" | "review" = "chat") {
  const { view, ctx: fresh } = await requireAi(ctx)
  if (kind === "onboarding") assertCan(fresh, "catalog.manage")
  const createdAt = new Date()
  const [row] = await getDb()
    .insert(aiConversations)
    .values({
      householdId: ctx.householdId,
      userId: ctx.userId,
      title:
        kind === "onboarding"
          ? interviewConversationTitle(createdAt, ctx.timezone, ctx.locale)
          : ctx.locale === "en"
            ? "New conversation"
            : "Новый диалог",
      createdAt,
      kind: z.enum(["chat", "onboarding", "review"]).parse(kind),
      dataLevel: view.dataLevel,
      consentFingerprint: fingerprint(view.provider),
    })
    .returning()
  return row!
}
export async function getConversation(ctx: HouseholdCtx, id: string) {
  const [row] = await getDb()
    .select()
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, z.uuid().parse(id)),
        eq(aiConversations.householdId, ctx.householdId),
        eq(aiConversations.userId, ctx.userId),
      ),
    )
  if (!row) throw notFound()
  return row
}
export async function conversationMessages(ctx: HouseholdCtx, id: string): Promise<UIMessage[]> {
  await getConversation(ctx, id)
  return (
    await getDb()
      .select({ id: aiMessages.id, role: aiMessages.role, parts: aiMessages.parts })
      .from(aiMessages)
      .where(and(eq(aiMessages.householdId, ctx.householdId), eq(aiMessages.conversationId, id)))
      .orderBy(asc(aiMessages.createdAt), asc(aiMessages.id))
  ).filter((message) => message.parts.length)
}
export async function deleteConversation(ctx: HouseholdCtx, id: string) {
  const conversation = await getConversation(ctx, id)
  if (conversation.busyUntil && conversation.busyUntil > new Date()) throw new AppError("ai.busy")
  await getDb()
    .delete(aiConversations)
    .where(and(eq(aiConversations.id, id), eq(aiConversations.householdId, ctx.householdId), eq(aiConversations.userId, ctx.userId)))
}
export function usageMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}
export async function monthlyUsage() {
  return getDb()
    .select({
      householdId: aiUsage.householdId,
      name: households.name,
      input: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)`.mapWith(Number),
      output: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)`.mapWith(Number),
      reserved: sql<number>`coalesce(sum(${aiUsage.reservedTokens}), 0)`.mapWith(Number),
    })
    .from(aiUsage)
    .innerJoin(households, eq(households.id, aiUsage.householdId))
    .where(gte(aiUsage.createdAt, usageMonth()))
    .groupBy(aiUsage.householdId, households.name)
}
export const turnInput = z.object({
  id: z.uuid(),
  message: z.object({
    id: z.uuid(),
    role: z.literal("user"),
    parts: z.array(z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(4000) })).length(1),
  }),
})
export async function beginTurn(ctx: HouseholdCtx, raw: z.input<typeof turnInput>) {
  const input = turnInput.parse(raw)
  await requireAi(ctx)
  return getDb().transaction(async (db) =>
    withDb(db, async () => {
      // Shared across replicas: the user lock serializes rate checks, the household lock serializes quota reservations.
      await db.select({ id: users.id }).from(users).where(eq(users.id, ctx.userId)).for("update")
      await db.select().from(aiHouseholdSettings).where(eq(aiHouseholdSettings.householdId, ctx.householdId)).for("update")
      const { config, view } = await requireAi(ctx)
      // Recover crashed/legacy turns before admitting another reservation under the same household lock.
      await db
        .update(aiUsage)
        .set({ reservedTokens: 0, reservationExpiresAt: null, errorCode: "interrupted" })
        .where(
          and(
            eq(aiUsage.householdId, ctx.householdId),
            gt(aiUsage.reservedTokens, 0),
            or(lt(aiUsage.reservationExpiresAt, new Date()), isNull(aiUsage.reservationExpiresAt)),
          ),
        )
      const recent = await db
        .select({ id: aiUsage.id })
        .from(aiUsage)
        .where(and(eq(aiUsage.userId, ctx.userId), gte(aiUsage.createdAt, new Date(Date.now() - 60_000))))
      if (recent.length >= 10) throw new AppError("ai.rateLimit")
      const [used] = await db
        .select({
          tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens} + ${aiUsage.reservedTokens}), 0)`.mapWith(
            Number,
          ),
        })
        .from(aiUsage)
        .where(and(eq(aiUsage.householdId, ctx.householdId), gte(aiUsage.createdAt, usageMonth())))
      if (config.monthlyTokenLimit && (used?.tokens ?? 0) + AI_TURN_RESERVATION > config.monthlyTokenLimit)
        throw new AppError("ai.monthlyLimit")
      const conversation = await getConversation(ctx, input.id)
      if (conversation.kind === "onboarding") assertCan((await requireAi(ctx)).ctx, "catalog.manage")
      if (conversation.busyUntil && conversation.busyUntil > new Date()) throw new AppError("ai.busy")
      if (conversation.consentFingerprint !== fingerprint(view.provider) || conversation.dataLevel !== view.dataLevel)
        throw new AppError("ai.consentChanged")
      const [existing] = await db.select().from(aiMessages).where(eq(aiMessages.id, input.message.id))
      if (
        existing &&
        (existing.conversationId !== input.id ||
          existing.householdId !== ctx.householdId ||
          fingerprint(existing.parts) !== fingerprint(input.message.parts))
      )
        throw new AppError("ai.invalidProposal")
      const [latest] = await db
        .select({ at: aiMessages.createdAt })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, input.id))
        .orderBy(desc(aiMessages.createdAt))
        .limit(1)
      const timestamp = Math.max(Date.now(), (latest?.at.getTime() ?? 0) + 1)
      if (!existing)
        await db.insert(aiMessages).values({
          id: input.message.id,
          conversationId: input.id,
          householdId: ctx.householdId,
          role: "user",
          parts: input.message.parts,
          createdAt: new Date(timestamp),
        })
      const messageId = randomUUID(),
        busyUntil = new Date(Date.now() + 120_000)
      await db.insert(aiMessages).values({
        id: messageId,
        conversationId: input.id,
        householdId: ctx.householdId,
        role: "assistant",
        parts: [],
        createdAt: new Date(timestamp + 1),
      })
      await db
        .update(aiConversations)
        .set({
          ...(conversation.kind === "onboarding" ? {} : { title: input.message.parts[0]!.text.slice(0, 80) }),
          busyUntil,
          version: sql`${aiConversations.version} + 1`,
        })
        .where(eq(aiConversations.id, input.id))
      const [usage] = await db
        .insert(aiUsage)
        .values({
          householdId: ctx.householdId,
          userId: ctx.userId,
          model: config.model,
          createdAt: new Date(),
          reservedTokens: AI_TURN_RESERVATION,
          reservationExpiresAt: new Date(busyUntil.getTime() + AI_RESERVATION_GRACE_MS),
        })
        .returning()
      const history = await conversationMessages(ctx, input.id)
      const userIndex = history.findIndex((message) => message.id === input.message.id)
      // A retry regenerates this turn, while retaining failed attempts in the private history.
      const messages = existing ? history.slice(0, userIndex + 1) : history
      return {
        config,
        kind: conversation.kind,
        dataLevel: view.dataLevel,
        messageId,
        usageId: usage!.id,
        busyUntil,
        messages,
        conversationId: input.id,
      }
    }),
  )
}
export async function finishTurn(
  ctx: HouseholdCtx,
  turn: Awaited<ReturnType<typeof beginTurn>>,
  message: UIMessage | undefined,
  inputTokens: number,
  outputTokens: number,
  durationMs: number,
  errorCode: string | null,
) {
  await getDb().transaction(async (db) => {
    await db.select().from(aiHouseholdSettings).where(eq(aiHouseholdSettings.householdId, ctx.householdId)).for("update")
    const [settled] = await db
      .update(aiUsage)
      .set({ inputTokens, outputTokens, reservedTokens: 0, reservationExpiresAt: null, durationMs, errorCode })
      .where(and(eq(aiUsage.id, turn.usageId), eq(aiUsage.householdId, ctx.householdId), isNotNull(aiUsage.reservationExpiresAt)))
      .returning({ id: aiUsage.id })
    if (!settled) return
    if (message)
      await db
        .update(aiMessages)
        .set({ parts: message.parts, inputTokens, outputTokens })
        .where(and(eq(aiMessages.id, turn.messageId), eq(aiMessages.householdId, ctx.householdId)))
    await db
      .update(aiConversations)
      .set({ busyUntil: null })
      .where(
        and(
          eq(aiConversations.id, turn.conversationId),
          eq(aiConversations.householdId, ctx.householdId),
          eq(aiConversations.busyUntil, turn.busyUntil),
        ),
      )
  })
}

/** Persist counters only: no prompts, responses or financial data are stored in usage checkpoints. */
export async function checkpointTurn(ctx: HouseholdCtx, usageId: string, inputTokens: number, outputTokens: number) {
  await getDb()
    .update(aiUsage)
    .set({ inputTokens, outputTokens, reservedTokens: Math.max(0, AI_TURN_RESERVATION - inputTokens - outputTokens) })
    .where(and(eq(aiUsage.id, usageId), eq(aiUsage.householdId, ctx.householdId), isNotNull(aiUsage.reservationExpiresAt)))
}

export const renameConversationInput = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(80).nullable(),
  version: z.number().int().positive(),
})
export async function renameConversation(ctx: HouseholdCtx, raw: z.input<typeof renameConversationInput>) {
  const input = renameConversationInput.parse(raw)
  await requireAi(ctx)
  const conversation = await getConversation(ctx, input.id)
  const now = new Date()
  if (conversation.busyUntil && conversation.busyUntil > now) throw new AppError("ai.busy")
  const rows = await getDb()
    .update(aiConversations)
    .set({ customTitle: input.title, version: sql`${aiConversations.version} + 1` })
    .where(
      and(
        eq(aiConversations.id, input.id),
        eq(aiConversations.householdId, ctx.householdId),
        eq(aiConversations.userId, ctx.userId),
        eq(aiConversations.version, input.version),
        or(isNull(aiConversations.busyUntil), lt(aiConversations.busyUntil, now)),
      ),
    )
    .returning({ id: aiConversations.id })
  if (!rows.length) throw conflict()
}
