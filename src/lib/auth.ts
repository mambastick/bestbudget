import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { admin } from "better-auth/plugins/admin"
import { genericOAuth } from "better-auth/plugins/generic-oauth"
import { browserLocale, isLocale, LOCALE_COOKIE } from "@/i18n/locale"
import { getUserLocale, rememberBrowserLocale } from "@/server/services/preferences"
import { getDb } from "@/db"
import { authAccounts, rateLimits, sessions, users, verifications } from "@/db/schema"
import { audit } from "@/server/audit"
import { findValidInvitation } from "@/server/services/households"
import { getAuthMethods, OIDC_PROVIDER_ID, type AuthMethods } from "@/server/services/settings"
import { sendPasswordResetMail, smtpEnabled } from "./mail"
import { appUrl, env } from "./env"

export const INVITE_COOKIE = "bb_invite"

/**
 * Sign-ups are closed by default. A user may be created only when:
 * - the server explicitly allows it (first-admin setup, invitation acceptance) via `allowSignup`;
 * - public registration is enabled by the admin;
 * - an SSO login arrives with a valid invitation cookie, or SSO auto-provisioning is enabled.
 */
// Kept on globalThis: the Next.js bundler may instantiate this module more than once (route handlers,
// server actions), while the auth instance itself is cached globally.
const globalForGate = globalThis as unknown as { __bestbudgetSignupGate?: AsyncLocalStorage<{ allowed: boolean }> }
const signupGate = (globalForGate.__bestbudgetSignupGate ??= new AsyncLocalStorage<{ allowed: boolean }>())

export function allowSignup<T>(fn: () => Promise<T>): Promise<T> {
  return signupGate.run({ allowed: true }, fn)
}

function readCookie(header: string | null | undefined, name: string) {
  if (!header) return undefined
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === name) return decodeURIComponent(v.join("="))
  }
  return undefined
}

function build(methods: AuthMethods) {
  const e = env()
  const oidc = methods.oidc
  const secure = appUrl().startsWith("https://")

  return betterAuth({
    appName: "BestBudget",
    baseURL: appUrl(),
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [appUrl()],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user: users, session: sessions, account: authAccounts, verification: verifications, rateLimit: rateLimits },
    }),
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: secure,
      cookiePrefix: "bestbudget",
      ipAddress: e.TRUST_PROXY ? { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] } : undefined,
    },
    logger: { level: "warn" },
    telemetry: { enabled: false },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    emailAndPassword: {
      enabled: methods.local,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: smtpEnabled()
        ? async ({ user, url }) => {
            await sendPasswordResetMail({ userId: user.id, to: user.email, url })
          }
        : undefined,
    },
    user: { additionalFields: { locale: { type: "string", required: false, input: false }, lastSeenLocale: { type: "string", required: false, input: false } } },
    account: {
      // SSO identities are never merged into existing accounts by e-mail; linking is explicit, from a signed-in session.
      accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: true },
    },
    rateLimit: {
      enabled: e.RATE_LIMIT_ENABLED ? e.RATE_LIMIT_ENABLED === "true" : process.env.NODE_ENV === "production",
      storage: "database",
      window: 60,
      max: 120,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
        "/change-password": { window: 60, max: 5 },
        "/sign-in/social": { window: 60, max: 10 },
      },
    },
    // Impersonation would give system admins access to household finances.
    disabledPaths: ["/admin/impersonate-user", "/admin/stop-impersonating"],
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const isOidc = ctx?.path?.includes(`/callback/${OIDC_PROVIDER_ID}`) ?? false
            const token = readCookie(ctx?.headers?.get("cookie"), INVITE_COOKIE)
            const allowed = signupGate.getStore()?.allowed || methods.publicRegistration || (isOidc && oidc?.allowSignup) || (token && await findValidInvitation(token))
            if (!allowed) return false
            const locale = readCookie(ctx?.headers?.get("cookie"), LOCALE_COOKIE)
            return { data: { ...user, locale: isLocale(locale) ? locale : null, lastSeenLocale: browserLocale(ctx?.headers?.get("accept-language")) } }
          },
          after: async (user) => {
            // Not awaited: Better Auth may still hold the new row in an open transaction.
            void audit({ action: "auth.user_created", entityType: "user", entityId: user.id, actorId: user.id }).catch(() => {})
          },
        },
      },
      session: {
        create: {
          after: async (session, ctx) => {
            const language = ctx?.headers?.get("accept-language")
            if (language) await rememberBrowserLocale(session.userId, browserLocale(language))
            const locale = await getUserLocale(session.userId)
            ctx?.setCookie(LOCALE_COOKIE, isLocale(locale) ? locale : "", {
              httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: isLocale(locale) ? 60 * 60 * 24 * 365 : 0,
            })
            void audit({ action: "auth.sign_in", entityType: "session", actorId: session.userId, meta: { userAgent: session.userAgent?.slice(0, 120) ?? null } }).catch(() => {})
          },
        },
      },
    },
    plugins: [
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      ...(oidc
        ? [
            genericOAuth({
              config: [
                {
                  providerId: OIDC_PROVIDER_ID,
                  name: oidc.displayName,
                  discoveryUrl: `${oidc.issuerUrl}/.well-known/openid-configuration`,
                  requireIdTokenVerification: true,
                  clientId: oidc.clientId,
                  clientSecret: oidc.clientSecret ?? undefined,
                  scopes: oidc.scopes,
                  redirectURI: oidc.redirectUri,
                  pkce: true,
                  disableProviderLogout: true,
                  mapProfileToUser: (profile) => ({
                    name:
                      (typeof profile.name === "string" && profile.name) ||
                      (typeof profile.preferred_username === "string" && profile.preferred_username) ||
                      String(profile.email ?? "User"),
                  }),
                },
              ],
            }),
          ]
        : []),
      nextCookies(),
    ],
  })
}

export type Auth = ReturnType<typeof build>

const globalForAuth = globalThis as unknown as {
  __bestbudgetAuth?: { key: string; auth: Auth; checkedAt: number; methods: AuthMethods }
}

/** How often settings are re-read from the database (changes made on another instance apply within this window). */
const SETTINGS_TTL_MS = 5_000

function fingerprint(m: AuthMethods) {
  return createHash("sha256").update(JSON.stringify(m)).digest("hex")
}

/**
 * Returns the Better Auth instance for the current settings. Login methods and the OIDC
 * provider can be changed at runtime from the admin UI, so the instance is rebuilt when they change.
 */
export async function getAuth(): Promise<Auth> {
  const cached = globalForAuth.__bestbudgetAuth
  if (cached && Date.now() - cached.checkedAt < SETTINGS_TTL_MS) return cached.auth
  const methods = await getAuthMethods()
  const key = fingerprint(methods)
  if (cached && cached.key === key) {
    cached.checkedAt = Date.now()
    return cached.auth
  }
  const auth = build(methods)
  globalForAuth.__bestbudgetAuth = { key, auth, checkedAt: Date.now(), methods }
  return auth
}

export function invalidateAuth() {
  globalForAuth.__bestbudgetAuth = undefined
}
