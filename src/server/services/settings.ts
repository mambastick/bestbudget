import "server-only"
import { eq, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { applicationSettings, authAccounts, oidcProviderSettings } from "@/db/schema"
import { decryptSecret, encryptSecret } from "@/lib/crypto"
import { appUrl, env } from "@/lib/env"
import { audit } from "../audit"
import { AppError } from "../errors"

// ---------------------------------------------------------------------------
// Application settings (key/value)
// ---------------------------------------------------------------------------

export const appSettingsSchema = z.object({
  appName: z.string().trim().min(1).max(40).default("BestBudget"),
  localAuthEnabled: z.boolean().default(true),
  publicRegistration: z.boolean().default(false),
})
export type AppSettings = z.output<typeof appSettingsSchema>

const KEYS: Record<keyof AppSettings, string> = {
  appName: "app.name",
  localAuthEnabled: "auth.local_enabled",
  publicRegistration: "auth.public_registration",
}

export async function getAppSettings(): Promise<AppSettings> {
  const rows = await getDb().select().from(applicationSettings)
  const byKey = new Map(rows.map((r) => [r.key, r.value]))
  const raw = Object.fromEntries(Object.entries(KEYS).map(([field, key]) => [field, byKey.get(key)]))
  const parsed = appSettingsSchema.safeParse(raw)
  return parsed.success ? parsed.data : appSettingsSchema.parse({})
}

async function writeSettings(patch: Partial<AppSettings>, actorId: string) {
  const db = getDb()
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const key = KEYS[field as keyof AppSettings]
    await db
      .insert(applicationSettings)
      .values({ key, value, updatedBy: actorId })
      .onConflictDoUpdate({ target: applicationSettings.key, set: { value, updatedBy: actorId } })
  }
}

// ---------------------------------------------------------------------------
// OIDC provider configuration. Priority: environment variables > database > none.
// ---------------------------------------------------------------------------

export const OIDC_PROVIDER_ID = "oidc"

export interface OidcConfig {
  source: "env" | "db"
  enabled: boolean
  displayName: string
  issuerUrl: string
  clientId: string
  clientSecret: string | null
  scopes: string[]
  redirectUri: string
  allowSignup: boolean
}

export function defaultRedirectUri() {
  return `${appUrl()}/api/auth/callback/${OIDC_PROVIDER_ID}`
}

function parseScopes(s: string | undefined | null) {
  const scopes = (s ?? "openid profile email").split(/[\s,]+/).filter(Boolean)
  return scopes.includes("openid") ? scopes : ["openid", ...scopes]
}

export async function getOidcConfig(): Promise<OidcConfig | null> {
  const e = env()
  if (e.OIDC_ISSUER) {
    if (!e.OIDC_CLIENT_ID) throw new Error("OIDC_CLIENT_ID is required when OIDC_ISSUER is set")
    return {
      source: "env",
      enabled: e.OIDC_ENABLED !== "false",
      displayName: e.OIDC_DISPLAY_NAME ?? "SSO",
      issuerUrl: e.OIDC_ISSUER,
      clientId: e.OIDC_CLIENT_ID,
      clientSecret: e.OIDC_CLIENT_SECRET ?? null,
      scopes: parseScopes(e.OIDC_SCOPES),
      redirectUri: e.OIDC_REDIRECT_URI ?? defaultRedirectUri(),
      allowSignup: e.OIDC_ALLOW_SIGNUP,
    }
  }
  const [row] = await getDb().select().from(oidcProviderSettings).where(eq(oidcProviderSettings.id, 1))
  if (!row) return null
  let clientSecret: string | null = null
  if (row.clientSecretEncrypted) {
    try {
      clientSecret = decryptSecret(row.clientSecretEncrypted)
    } catch {
      // Key rotated or corrupted: treat SSO as not configured instead of crashing the login page.
      console.error("[auth] cannot decrypt the stored OIDC client secret; check ENCRYPTION_KEY")
      return { ...rowToConfig(row), enabled: false }
    }
  }
  return { ...rowToConfig(row), clientSecret }
}

function rowToConfig(row: typeof oidcProviderSettings.$inferSelect): OidcConfig {
  return {
    source: "db",
    enabled: row.enabled,
    displayName: row.displayName,
    issuerUrl: row.issuerUrl,
    clientId: row.clientId,
    clientSecret: null,
    scopes: parseScopes(row.scopes),
    redirectUri: row.redirectUri || defaultRedirectUri(),
    allowSignup: row.allowSignup,
  }
}

/** Effective login methods, with guarantees against lock-out. */
export interface AuthMethods {
  local: boolean
  oidc: OidcConfig | null
  publicRegistration: boolean
  /** Local login is forced on by AUTH_FORCE_LOCAL_LOGIN (emergency access). */
  localForced: boolean
}

export async function getAuthMethods(): Promise<AuthMethods> {
  const [settings, oidc] = await Promise.all([getAppSettings(), getOidcConfig().catch(() => null)])
  const oidcUsable = oidc?.enabled && oidc.clientId ? oidc : null
  const forced = env().AUTH_FORCE_LOCAL_LOGIN
  return {
    // If SSO is not usable, local login is always available — the system can never end up with zero login methods.
    local: settings.localAuthEnabled || forced || !oidcUsable,
    oidc: oidcUsable,
    publicRegistration: settings.publicRegistration,
    localForced: forced,
  }
}

// ---------------------------------------------------------------------------
// Admin updates
// ---------------------------------------------------------------------------

export const authSettingsInput = z.object({
  appName: z.string().trim().min(1, "validation.titleRequired").max(40),
  localAuthEnabled: z.boolean(),
  publicRegistration: z.boolean(),
})

export async function updateAuthSettings(actorId: string, raw: z.input<typeof authSettingsInput>) {
  const input = authSettingsInput.parse(raw)
  if (!input.localAuthEnabled) {
    const oidc = await getOidcConfig().catch(() => null)
    if (!oidc?.enabled) throw new AppError("settings.ssoRequired")
    const [linked] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(authAccounts)
      .where(sql`${authAccounts.userId} = ${actorId} and ${authAccounts.providerId} = ${OIDC_PROVIDER_ID}`)
    if ((linked?.n ?? 0) === 0) {
      throw new AppError("settings.linkSsoFirst")
    }
  }
  await writeSettings(input, actorId)
  await audit({ action: "settings.auth.update", entityType: "settings", actorId, meta: input })
}

export const oidcInput = z.object({
  enabled: z.boolean(),
  displayName: z.string().trim().min(1).max(40),
  issuerUrl: z.url("validation.issuer").refine((u) => /^https?:\/\//.test(u), "validation.http"),
  clientId: z.string().trim().min(1, "validation.clientId").max(200),
  /** Empty keeps the stored secret. */
  clientSecret: z.string().max(500).optional(),
  scopes: z.string().trim().max(200).default("openid profile email"),
  redirectUri: z.union([z.url(), z.literal("")]).optional(),
  allowSignup: z.boolean(),
})

export async function updateOidcSettings(actorId: string, raw: z.input<typeof oidcInput>) {
  if (env().OIDC_ISSUER) throw new AppError("settings.ssoFromEnv")
  const input = oidcInput.parse(raw)
  const methods = await getAuthMethods()
  if (!input.enabled && !methods.local) {
    throw new AppError("settings.passwordDisabled")
  }
  const values = {
    enabled: input.enabled,
    displayName: input.displayName,
    issuerUrl: input.issuerUrl.replace(/\/+$/, ""),
    clientId: input.clientId,
    scopes: parseScopes(input.scopes).join(" "),
    redirectUri: input.redirectUri || null,
    allowSignup: input.allowSignup,
    updatedBy: actorId,
    ...(input.clientSecret ? { clientSecretEncrypted: encryptSecret(input.clientSecret) } : {}),
  }
  await getDb().insert(oidcProviderSettings).values({ id: 1, ...values }).onConflictDoUpdate({ target: oidcProviderSettings.id, set: values })
  // The secret itself is never logged.
  await audit({
    action: "settings.oidc.update",
    entityType: "settings",
    actorId,
    meta: { enabled: input.enabled, issuerUrl: values.issuerUrl, clientId: input.clientId, secretChanged: Boolean(input.clientSecret) },
  })
}

/** Checks that the issuer publishes a valid discovery document. */
export async function testOidcDiscovery(issuerUrl: string) {
  const url = `${issuerUrl.replace(/\/+$/, "")}/.well-known/openid-configuration`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "error" })
  if (!res.ok) throw new AppError("settings.discoveryHttp", { status: res.status })
  const doc = (await res.json()) as Record<string, unknown>
  for (const key of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    if (typeof doc[key] !== "string") throw new AppError("settings.discoveryField", { key: key })
  }
  return { issuer: doc.issuer as string, authorizationEndpoint: doc.authorization_endpoint as string }
}
