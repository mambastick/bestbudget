import { APICallError } from "ai"
import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getDb } from "@/db"
import { aiSettings } from "@/db/schema"
import { decryptSecret, encryptSecret } from "@/lib/crypto"
import { configForInput, getAiConfig, publicAiConfig, recordConnectionCheck, saveAiSettings, verifyConnection } from "@/server/ai/config"
import { listModels } from "@/server/ai/providers"
import { createUser } from "./helpers"

const db = getDb()
beforeEach(async () => {
  vi.stubEnv("AI_PROVIDER", "")
  await db.delete(aiSettings)
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe("AI connection settings", () => {
  it("new nonempty key wins over clearKey; whitespace retains/removes the saved key", async () => {
    const user = await createUser()
    const input = { provider: "mock" as const, model: "test-budget", enabled: false }
    await saveAiSettings(user.id, { ...input, apiKey: "old-key-1234" })
    expect((await configForInput({ ...input, clearKey: true, apiKey: " new-key-5678 " })).apiKey).toBe("new-key-5678")
    await saveAiSettings(user.id, { ...input, clearKey: true, apiKey: " new-key-5678 " })
    const [row] = await db.select().from(aiSettings)
    expect(decryptSecret(row!.apiKeyEncrypted!)).toBe("new-key-5678")
    expect(row!.apiKeyLast4).toBe("5678")
    const safe = await publicAiConfig()
    expect(safe).toMatchObject({ hasKey: true, keyLast4: "5678" })
    expect(JSON.stringify(safe)).not.toContain("new-key")
    expect((await configForInput({ ...input, apiKey: "   " })).apiKey).toBe("new-key-5678")
    await saveAiSettings(user.id, { ...input, clearKey: true, apiKey: "   " })
    expect((await db.select().from(aiSettings))[0]).toMatchObject({ apiKeyEncrypted: null, apiKeyLast4: null })
    expect(await publicAiConfig()).toMatchObject({ hasKey: false, keyLast4: "" })
  })
  it("backfills the display suffix of a legacy key without exposing plaintext", async () => {
    await db.insert(aiSettings).values({ apiKeyEncrypted: encryptSecret("legacy-key-abcd") })
    expect(await publicAiConfig()).toMatchObject({ hasKey: true, keyLast4: "abcd" })
    expect((await db.select().from(aiSettings))[0]?.apiKeyLast4).toBe("abcd")
  })
  it("persists only code, HTTP status and time for failed checks; success clears them", async () => {
    const config = await configForInput({ provider: "mock", model: "test-error-401", apiKey: "synthetic-secret" })
    await expect(verifyConnection(config)).rejects.toMatchObject({ messageKey: "ai.keyRejected", diagnostic: { status: 401 } })
    const [row] = await db.select().from(aiSettings)
    expect(row).toMatchObject({ lastErrorCode: "ai.keyRejected", lastErrorStatus: 401, lastErrorAt: new Date(), apiKeyEncrypted: null })
    expect(JSON.stringify(row)).not.toMatch(/synthetic-secret|Synthetic provider rejection/)
    expect((await publicAiConfig())?.lastError).toEqual({ code: "ai.keyRejected", status: 401, at: new Date().toISOString() })
    await verifyConnection({ ...config, model: "test-budget" })
    expect((await db.select().from(aiSettings))[0]).toMatchObject({ lastErrorCode: null, lastErrorStatus: null, lastErrorAt: null })
  })
  it("model-list failures preserve configuration, version, key and verification", async () => {
    const user = await createUser()
    await saveAiSettings(user.id, { provider: "mock", model: "test-budget", enabled: true, apiKey: "key-1234" })
    const [before] = await db.select().from(aiSettings)
    const config = (await getAiConfig())!
    await expect(recordConnectionCheck(config, () => listModels({ ...config, model: "test-error-402" }))).rejects.toMatchObject({ messageKey: "ai.noCredits" })
    expect((await db.select().from(aiSettings))[0]).toMatchObject({ ...before, lastErrorCode: "ai.noCredits", lastErrorStatus: 402, lastErrorAt: new Date(), updatedAt: expect.any(Date) })
  })
  it("network failures have a persisted code and no HTTP status", async () => {
    const config = await configForInput({ provider: "mock", model: "test-error-timeout" })
    await expect(verifyConnection(config)).rejects.toMatchObject({ messageKey: "ai.networkError" })
    expect((await db.select().from(aiSettings))[0]).toMatchObject({ lastErrorCode: "ai.networkError", lastErrorStatus: null })
  })
  it("failed enabled saves keep a working configuration and optimistic version", async () => {
    const user = await createUser()
    await saveAiSettings(user.id, { provider: "mock", model: "test-budget", enabled: true })
    const config = (await getAiConfig())!
    await expect(saveAiSettings(user.id, { ...config, model: "test-error-401" })).rejects.toMatchObject({ messageKey: "ai.keyRejected" })
    expect(await getAiConfig()).toMatchObject({ model: "test-budget", ready: true, version: config.version })
    await db.update(aiSettings).set({ version: config.version! + 1 }).where(eq(aiSettings.id, 1))
    await expect(saveAiSettings(user.id, config)).rejects.toMatchObject({ code: "conflict" })
  })
  it("wraps SDK errors before storing them without error bodies", async () => {
    const config = await configForInput({ provider: "mock" })
    await expect(recordConnectionCheck(config, async () => { throw new APICallError({ message: "hidden", url: "https://synthetic.invalid", requestBodyValues: {}, statusCode: 500, responseBody: "private-body" }) })).rejects.toMatchObject({ diagnostic: { status: 500 } })
    expect(JSON.stringify(await db.select().from(aiSettings))).not.toContain("private-body")
  })
})
