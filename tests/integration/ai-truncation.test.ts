import { randomUUID } from "node:crypto"
import { MockLanguageModelV3 } from "ai/test"
import { convertToModelMessages, simulateReadableStream } from "ai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { aiConversations, aiSettings, aiUsage } from "@/db/schema"
import { truncationReason } from "@/domain/ai/truncation"
import { chatResponse } from "@/server/ai/chat"
import { fingerprint, getAiConfig, saveAiSettings, snapshot } from "@/server/ai/config"
import { saveHouseholdAi } from "@/server/ai/access"
import { conversationMessages, createConversation } from "@/server/ai/conversations"
import * as providers from "@/server/ai/providers"
import { setupHousehold } from "./helpers"

// A real turn budget would make the timeout path wait for minutes.
vi.mock("@/domain/ai/types", async (original) => ({ ...(await original<typeof import("@/domain/ai/types")>()), AI_TURN_TIMEOUT_MS: 300 }))

const db = getDb()
const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 50, text: 50, reasoning: 0 },
}
beforeEach(async () => {
  vi.stubEnv("AI_PROVIDER", "")
  await db.delete(aiSettings)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function turn(text: string, stream: { slow?: boolean; finish?: "stop" | "length"; stopAfterMs?: number }) {
  const stop = new AbortController()
  const fixture = await setupHousehold("AI truncation synthetic")
  await saveAiSettings(fixture.owner.id, { provider: "mock", model: "test-budget", enabled: true })
  const config = (await getAiConfig())!
  await saveHouseholdAi(fixture.ctx, {
    enabled: true,
    consent: true,
    providerFingerprint: fingerprint(snapshot(config)),
    dataLevel: "aggregates",
    version: 0,
  })
  const conversation = await createConversation(fixture.ctx)
  vi.spyOn(providers, "languageModel").mockResolvedValue(
    new MockLanguageModelV3({
      doStream: async () => {
        if (stream.stopAfterMs) setTimeout(() => stop.abort(), stream.stopAfterMs)
        return {
        stream: simulateReadableStream({
          chunkDelayInMs: stream.slow ? 150 : 0,
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "text" },
            { type: "text-delta", id: "text", delta: "Начало ответа **" },
            ...(stream.slow
              ? [
                  { type: "text-delta" as const, id: "text", delta: " продолжение" },
                  { type: "text-delta" as const, id: "text", delta: " и ещё" },
                  { type: "text-delta" as const, id: "text", delta: " и ещё" },
                ]
              : []),
            { type: "text-end", id: "text" },
            {
              type: "finish",
              finishReason: { unified: stream.finish ?? "stop", raw: stream.finish ?? "stop" },
              usage,
            },
          ],
        }),
        }
      },
    }),
  )
  const response = await chatResponse(
    fixture.ctx,
    { id: conversation.id, message: { id: randomUUID(), role: "user", parts: [{ type: "text", text }] } },
    stop.signal,
  )
  await response.text()
  return { ...fixture, conversation }
}

describe("AI answer truncation", () => {
  it("marks an answer stopped by the token limit and keeps its text", async () => {
    const f = await turn("Составь план", { finish: "length" })
    const answer = (await conversationMessages(f.ctx, f.conversation.id)).at(-1)!
    expect(truncationReason(answer)).toBe("length")
    expect(answer.parts).toContainEqual(expect.objectContaining({ type: "text", text: "Начало ответа **" }))
    const [row] = await db.select().from(aiUsage).where(eq(aiUsage.householdId, f.ctx.householdId))
    expect(row!.errorCode).toBeNull()
  })
  it("marks an answer stopped by a timeout, unlike a user stop", async () => {
    const f = await turn("Составь план", { slow: true })
    const answer = (await conversationMessages(f.ctx, f.conversation.id)).at(-1)!
    expect(truncationReason(answer)).toBe("timeout")
    const [row] = await db.select().from(aiUsage).where(eq(aiUsage.householdId, f.ctx.householdId))
    expect(row!.errorCode).toBe("timeout")
  })
  it("does not mark an answer the user stopped", async () => {
    const f = await turn("Составь план", { slow: true, stopAfterMs: 100 })
    const answer = (await conversationMessages(f.ctx, f.conversation.id)).at(-1)!
    expect(truncationReason(answer)).toBeNull()
    const [row] = await db.select().from(aiUsage).where(eq(aiUsage.householdId, f.ctx.householdId))
    expect(row!.errorCode).toBe("aborted")
  })
  it("does not mark a complete answer", async () => {
    const f = await turn("Составь план", {})
    expect(truncationReason((await conversationMessages(f.ctx, f.conversation.id)).at(-1)!)).toBeNull()
  })
  it("never sends the marker back to the model, even without any text", async () => {
    const f = await turn("Составь план", { finish: "length" })
    const messages = await conversationMessages(f.ctx, f.conversation.id)
    expect(JSON.stringify(await convertToModelMessages(messages))).not.toContain("truncated")
    const empty = { id: randomUUID(), role: "assistant" as const, parts: [{ type: "data-truncated" as const, data: { reason: "timeout" } }] }
    expect(await convertToModelMessages([empty])).toEqual([])
  })
  it("titles a conversation with one short line cut on a word boundary", async () => {
    const f = await turn(`придумай агрессивный план погашения кредитных карт и всех прочих долгов семьи\nв декабре будет премия`, {})
    const [row] = await db.select().from(aiConversations).where(eq(aiConversations.id, f.conversation.id))
    expect(row!.title).toBe("придумай агрессивный план погашения кредитных карт и всех…")
  })
})
