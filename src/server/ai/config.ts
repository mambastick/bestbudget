import "server-only"
import { createHash } from "node:crypto"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { aiSettings } from "@/db/schema"
import { PROVIDERS, type AiProvider, type ProviderSnapshot } from "@/domain/ai/types"
import { encryptSecret, decryptSecret } from "@/lib/crypto"
import { audit } from "@/server/audit"
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
export const settingsInput = z.object({
  version: z.number().int().nonnegative().optional(),
  provider: z.enum([...PROVIDERS, "mock"]),
  baseUrl: httpUrl.default(""),
  apiKey: z.string().max(4000).optional(),
  clearKey: z.boolean().default(false),
  model: z.string().trim().min(1).max(200),
  temperature: z.number().min(0).max(2).nullable().default(null),
  monthlyTokenLimit: z.number().int().safe().nonnegative().default(0),
  enabled: z.boolean().default(false),
  selfHosted: z.boolean().default(false),
  gigachatScope: z.enum(["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"]).default("GIGACHAT_API_PERS"),
  gigachatAuthUrl: httpUrl.default("https://ngw.devices.sberbank.ru:9443/api/v2/oauth"),
})
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
  if (!fromEnv && !row?.model) return null
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
      verifiedFingerprint: null,
      temperature: input.temperature === null ? null : String(input.temperature),
      apiKeyEncrypted: input.clearKey ? null : input.apiKey ? encryptSecret(input.apiKey) : (row?.apiKeyEncrypted ?? null),
    },
    {},
  )!
}
export async function saveAiSettings(actorId: string, raw: SettingsInput) {
  if (process.env.AI_PROVIDER) throw new AppError("ai.envLocked")
  const config = await configForInput(raw)
  if (raw.version !== undefined && raw.version !== config.version) throw conflict()
  const { probeConnection } = await import("./providers")
  if (config.enabled) await probeConnection(config)
  const values = {
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
    selfHosted: config.selfHosted,
    apiKeyEncrypted: config.apiKey ? encryptSecret(config.apiKey) : null,
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
  await probeConnection(config)
  if (config.source !== "env") return
  await getDb()
    .insert(aiSettings)
    .values({ id: 1, verifiedFingerprint: connectionFingerprint(config) })
    .onConflictDoUpdate({ target: aiSettings.id, set: { verifiedFingerprint: connectionFingerprint(config) } })
}
export async function publicAiConfig() {
  const config = await getAiConfig()
  if (!config) return null
  const { apiKey, ...safe } = config
  return { ...safe, hasKey: Boolean(apiKey) }
}
