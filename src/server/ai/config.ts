import "server-only"
import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { aiSettings } from "@/db/schema"
import { PROVIDERS, type AiProvider, type ProviderSnapshot } from "@/domain/ai/types"
import { encryptSecret, decryptSecret } from "@/lib/crypto"
import { audit } from "@/server/audit"
import { aiProviderError } from "./errors"
import { AppError, conflict } from "@/server/errors"

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (!value) return true
    try {
      const url = new URL(value)
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    } catch {
      return false
    }
  })
export const settingsInput = z
  .object({
    version: z.number().int().nonnegative().optional(),
    provider: z.enum([...PROVIDERS, "mock"]),
    baseUrl: httpUrl.default(""),
    apiKey: z.string().trim().max(4000).optional(),
    clearKey: z.boolean().default(false),
    model: z.string().trim().max(200).default(""),
    temperature: z.number().min(0).max(2).nullable().default(null),
    monthlyTokenLimit: z.number().int().safe().nonnegative().default(0),
    enabled: z.boolean().default(false),
    selfHosted: z.boolean().default(false),
    gigachatScope: z.enum(["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"]).default("GIGACHAT_API_PERS"),
    gigachatAuthUrl: httpUrl.default("https://ngw.devices.sberbank.ru:9443/api/v2/oauth"),
  })
  .refine((config) => !config.enabled || config.model.length > 0, { path: ["model"], message: "validation.titleRequired" })
export type SettingsInput = z.input<typeof settingsInput>
export interface AiConfig extends z.output<typeof settingsInput> {
  source: "env" | "db"
  apiKey: string
  ready: boolean
}
const DEFAULT_URLS: Record<AiProvider, string> = {
  openai: "https://api.openai.com/v1",
  openai_compatible: "",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  gigachat: "https://api.giga.chat/v1",
  mock: "",
}
export function mockAllowed() {
  return process.env.NODE_ENV === "test" || (process.env.NEXT_PUBLIC_AI_TEST_BUILD === "1" && process.env.AI_TEST_MODE === "1")
}
export function snapshot(config: AiConfig): ProviderSnapshot {
  return { provider: config.provider, baseUrl: config.baseUrl, model: config.model, selfHosted: config.selfHosted }
}
export function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
          : item,
      ),
    )
    .digest("hex")
}
export function connectionFingerprint(config: AiConfig) {
  return fingerprint([snapshot(config), config.apiKey, config.gigachatScope, config.gigachatAuthUrl, config.temperature])
}
export function resolveConfig(
  row: typeof aiSettings.$inferSelect | undefined,
  environment: Partial<NodeJS.ProcessEnv>,
  decrypt = decryptSecret,
): AiConfig | null {
  const fromEnv = Boolean(environment.AI_PROVIDER)
  if (!fromEnv && !row) return null
  const parsed = settingsInput.parse(
    fromEnv
      ? {
          provider: environment.AI_PROVIDER,
          baseUrl: environment.AI_BASE_URL || "",
          apiKey: environment.AI_API_KEY || "",
          model: environment.AI_MODEL,
          enabled: environment.AI_ENABLED === "true",
          selfHosted: environment.AI_SELF_HOSTED === "true",
          temperature: environment.AI_TEMPERATURE ? Number(environment.AI_TEMPERATURE) : null,
          monthlyTokenLimit: Number(environment.AI_MONTHLY_TOKEN_LIMIT || 0),
          gigachatScope: environment.AI_GIGACHAT_SCOPE || "GIGACHAT_API_PERS",
          gigachatAuthUrl: environment.AI_GIGACHAT_AUTH_URL || undefined,
        }
      : {
          ...row,
          apiKey: row?.apiKeyEncrypted ? decrypt(row.apiKeyEncrypted) : "",
          temperature: row?.temperature === null ? null : Number(row?.temperature),
        },
  )
  if (parsed.provider === "mock" && !mockAllowed()) throw new AppError("ai.mockDisabled")
  const config: AiConfig = {
    ...parsed,
    version: row?.version ?? 0,
    apiKey: parsed.apiKey ?? "",
    source: fromEnv ? "env" : "db",
    baseUrl: (parsed.baseUrl || DEFAULT_URLS[parsed.provider]).replace(/\/+$/, ""),
    ready: false,
  }
  config.ready = Boolean(config.baseUrl || config.provider === "mock") && row?.verifiedFingerprint === connectionFingerprint(config)
  return config
}
export async function getAiConfig() {
  const [row] = await getDb().select().from(aiSettings).where(eq(aiSettings.id, 1))
  return resolveConfig(row, process.env)
}
export async function configForInput(raw: SettingsInput) {
  if (process.env.AI_PROVIDER) return (await getAiConfig())!
  const input = settingsInput.parse(raw)
  const [row] = await getDb().select().from(aiSettings).where(eq(aiSettings.id, 1))
  return resolveConfig(
    {
      ...row,
      ...input,
      id: 1,
      version: row?.version ?? 0,
      updatedAt: new Date(),
      apiKeyLast4: row?.apiKeyLast4 ?? null,
      lastErrorCode: row?.lastErrorCode ?? null,
      lastErrorStatus: row?.lastErrorStatus ?? null,
      lastErrorAt: row?.lastErrorAt ?? null,
      verifiedFingerprint: null,
      temperature: input.temperature === null ? null : String(input.temperature),
      apiKeyEncrypted: input.apiKey ? encryptSecret(input.apiKey) : input.clearKey ? null : (row?.apiKeyEncrypted ?? null),
    },
    {},
  )!
}
export async function saveAiSettings(actorId: string, raw: SettingsInput) {
  if (process.env.AI_PROVIDER) throw new AppError("ai.envLocked")
  const config = await configForInput(raw)
  if (raw.version !== undefined && raw.version !== config.version) throw conflict()
  const { probeConnection } = await import("./providers")
  if (config.enabled) await recordConnectionCheck(config, () => probeConnection(config))
  const values = {
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    selfHosted: config.selfHosted,
    apiKeyEncrypted: config.apiKey ? encryptSecret(config.apiKey) : null,
    apiKeyLast4: config.apiKey ? config.apiKey.slice(-4) : null,
    temperature: config.temperature === null ? null : String(config.temperature),
    monthlyTokenLimit: config.monthlyTokenLimit,
    gigachatScope: config.gigachatScope,
    gigachatAuthUrl: config.gigachatAuthUrl,
    verifiedFingerprint: config.enabled ? connectionFingerprint(config) : null,
  }
  const changed =
    config.version === 0
      ? await getDb()
          .insert(aiSettings)
          .values({ id: 1, ...values })
          .onConflictDoNothing()
          .returning()
      : await getDb()
          .update(aiSettings)
          .set({ ...values, version: (config.version ?? 0) + 1 })
          .where(eq(aiSettings.version, config.version!))
          .returning()
  if (!changed.length) throw conflict()
  await audit({
    action: "settings.ai.update",
    entityType: "settings",
    actorId,
    meta: { enabled: config.enabled, provider: config.provider },
  })
}
export async function verifyConnection(config: AiConfig) {
  const { probeConnection } = await import("./providers")
  await recordConnectionCheck(config, () => probeConnection(config))
  if (config.source !== "env") return
  await getDb()
    .insert(aiSettings)
    .values({ id: 1, verifiedFingerprint: connectionFingerprint(config) })
    .onConflictDoUpdate({ target: aiSettings.id, set: { verifiedFingerprint: connectionFingerprint(config) } })
}
/** Store only diagnostic identity and time, never provider text or credentials. */
export async function recordConnectionCheck<T>(config: AiConfig, check: () => Promise<T>): Promise<T> {
  try {
    const result = await check()
    await getDb().update(aiSettings).set({ lastErrorCode: null, lastErrorStatus: null, lastErrorAt: null }).where(eq(aiSettings.id, 1))
    return result
  } catch (error) {
    const failure = aiProviderError(error, [config.apiKey])
    if (failure.diagnostic || failure.messageKey === "ai.noTools") {
      const values = {
        lastErrorCode: failure.diagnostic?.code ?? "ai.noTools" as const,
        lastErrorStatus: failure.diagnostic?.status ?? null,
        lastErrorAt: new Date(),
      }
      await getDb().insert(aiSettings).values({ id: 1, ...values }).onConflictDoUpdate({ target: aiSettings.id, set: values })
    }
    throw failure
  }
}
export async function publicAiConfig() {
  const config = await getAiConfig()
  if (!config) return null
  const [row] = await getDb().select().from(aiSettings).where(eq(aiSettings.id, 1))
  const { apiKey, ...safe } = config
  // Legacy encrypted keys acquire their display suffix once on the server.
  let keyLast4 = config.source === "env" ? apiKey.slice(-4) : row?.apiKeyLast4
  if (config.source === "db" && apiKey && !keyLast4 && row?.apiKeyEncrypted) {
    keyLast4 = apiKey.slice(-4)
    await getDb().update(aiSettings).set({ apiKeyLast4: keyLast4 }).where(eq(aiSettings.apiKeyEncrypted, row.apiKeyEncrypted))
  }
  return {
    ...safe, hasKey: Boolean(apiKey), keyLast4: keyLast4 ?? "",
    lastError: row?.lastErrorCode ? { code: row.lastErrorCode, status: row.lastErrorStatus, at: row.lastErrorAt?.toISOString() ?? null } : null,
  }
}
