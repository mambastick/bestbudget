import { randomUUID } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { OAuth2Server } from "oauth2-mock-server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { closeDb, getDb } from "@/db"
import { auditLogs, authAccounts, householdMembers, users } from "@/db/schema"
import { allowSignup, getAuth, invalidateAuth } from "@/lib/auth"
import { createHousehold } from "@/server/services/households"
import { updateOidcSettings } from "@/server/services/settings"
import { createUser } from "./helpers"
import { errorMessage } from "@/i18n/errors"
import { setUserLocale } from "@/server/services/preferences"
import { hasOidcRoleDemotionWarning } from "@/server/services/oidc-roles"

const mapping = { claim: "groups", userGroup: "app-budget-users", adminGroup: "app-budget-admins" }
const idp = new OAuth2Server()
const identities = new Map<string, Record<string, unknown>>()
const codes = new Map<string, Record<string, unknown>>()
let authFactory = getAuth

beforeAll(async () => {
  // PGlite has one backend; real PostgreSQL exercises concurrent connections in CI.
  process.env.DB_POOL_MAX = process.env.TEST_POSTGRES_URL ? "4" : "1"
  process.env.OIDC_GROUPS_CLAIM = mapping.claim
  process.env.OIDC_USER_GROUP = mapping.userGroup
  process.env.OIDC_ADMIN_GROUP = mapping.adminGroup
  await idp.issuer.keys.generate("RS256")
  await idp.start(0, "127.0.0.1")
  idp.service.on("beforeAuthorizeRedirect", ({ url }, request) => {
    const identity = identities.get(String(request.query.login_hint))
    const code = url.searchParams.get("code")
    if (identity && code) codes.set(code, identity)
  })
  idp.service.on("beforeTokenSigning", (token, request) => {
    const code = String(request.body.code)
    Object.assign(token.payload, codes.get(code))
  })
  const admin = await createUser("Setup")
  await updateOidcSettings(admin.id, {
    enabled: true, displayName: "Test SSO", issuerUrl: idp.issuer.url!, clientId: "bestbudget",
    clientSecret: "test-client-secret", scopes: "openid profile email groups", allowSignup: true,
  })
  invalidateAuth()
})

afterAll(async () => {
  await idp.stop()
  await closeDb()
  delete process.env.OIDC_GROUPS_CLAIM
  delete process.env.OIDC_USER_GROUP
  delete process.env.OIDC_ADMIN_GROUP
  invalidateAuth()
})

function cookieHeader(response: Response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ")
}

function authorizationUrl(url: string, profile: Record<string, unknown>) {
  const key = randomUUID()
  identities.set(key, profile)
  const authorization = new URL(url)
  authorization.searchParams.set("login_hint", key)
  return authorization
}

async function signIn(profile: Record<string, unknown>, headers: Record<string, string> = {}) {
  const auth = await authFactory()
  const started = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify({ provider: "oidc", callbackURL: "/dashboard", errorCallbackURL: "/login", disableRedirect: true }),
  }))
  expect(started.status).toBe(200)
  const { url } = await started.json() as { url: string }
  const authorization = await fetch(authorizationUrl(url, profile), { redirect: "manual" })
  expect(authorization.status).toBe(302)
  const callback = await auth.handler(new Request(authorization.headers.get("location")!, {
    headers: { ...headers, cookie: [headers.cookie, cookieHeader(started)].filter(Boolean).join("; ") },
  }))
  const session = await auth.api.getSession({ headers: new Headers({ cookie: cookieHeader(callback) }) })
  return { callback, session, cookie: cookieHeader(callback) }
}

function profile(groups: unknown) {
  const subject = randomUUID()
  return { sub: subject, email: `${subject}@oidc.test`, email_verified: true, name: "SSO User", groups }
}

describe("verified OIDC group mapping through real callbacks", () => {
  it("creates an admin from the admin group alone", async () => {
    const result = await signIn(profile([mapping.adminGroup]))
    expect(result.callback.headers.get("location")).toBe("/dashboard")
    expect(result.session?.user.role).toBe("admin")
  })

  it("promotes and demotes the bound account on later sign-in without changing household access", async () => {
    const incoming = profile([mapping.userGroup])
    const first = await signIn(incoming)
    expect(first.session?.user.role).toBe("user")
    const userId = first.session!.user.id
    const household = await createHousehold(userId, { name: "Unchanged household" })
    expect((await signIn({ ...incoming, groups: [mapping.adminGroup] })).session?.user.role).toBe("admin")
    const auth = await getAuth()
    expect((await auth.api.getSession({ headers: new Headers({ cookie: first.cookie }) }))?.user.role).toBe("admin")
    expect((await signIn({ ...incoming, groups: [mapping.userGroup] })).session?.user.role).toBe("user")
    expect((await auth.api.getSession({ headers: new Headers({ cookie: first.cookie }) }))?.user.role).toBe("user")
    const [membership] = await getDb().select().from(householdMembers).where(eq(householdMembers.householdId, household.id))
    expect(membership).toMatchObject({ userId, role: "owner" })
    const linked = await getDb().select().from(authAccounts).where(eq(authAccounts.userId, userId))
    expect(linked).toHaveLength(1)
    expect(linked[0]).toMatchObject({ providerId: "oidc", accountId: incoming.sub })
  })

  it("preserves explicit locale and remembers browser language while synchronizing roles", async () => {
    const incoming = profile([mapping.userGroup])
    const first = await signIn(incoming, { cookie: "bb_locale=ru", "accept-language": "en-US" })
    const id = first.session!.user.id
    expect(first.session?.user).toMatchObject({ role: "user", locale: "ru" })
    expect(first.callback.headers.getSetCookie().some((cookie) => cookie.startsWith("bb_locale=ru;"))).toBe(true)
    expect((await getDb().select().from(users).where(eq(users.id, id)))[0]).toMatchObject({ locale: "ru", lastSeenLocale: "en" })
    await setUserLocale(id, "en")
    const promoted = await signIn({ ...incoming, groups: [mapping.adminGroup] }, { cookie: "bb_locale=ru", "accept-language": "ru-RU" })
    expect(promoted.session?.user).toMatchObject({ id, role: "admin", locale: "en" })
    expect(promoted.callback.headers.getSetCookie().some((cookie) => cookie.startsWith("bb_locale=en;"))).toBe(true)
    expect((await getDb().select().from(users).where(eq(users.id, id)))[0]).toMatchObject({ locale: "en", lastSeenLocale: "ru" })
  })

  it("denies a returning identity with removed groups without rewriting its role or revoking old sessions", async () => {
    const incoming = profile([mapping.adminGroup])
    const first = await signIn(incoming)
    const denied = await signIn({ ...incoming, groups: [] })
    expect(denied.session).toBeNull()
    expect(denied.callback.headers.get("location")).toContain("error=oidc_access_denied")
    const auth = await getAuth()
    expect((await auth.api.getSession({ headers: new Headers({ cookie: first.cookie }) }))?.user.role).toBe("admin")
  })

  it.each(["ru", "en"])("localizes group access errors in %s", async (locale) => {
    const { callback } = await signIn(profile([]), { cookie: `bb_locale=${locale}`, "accept-language": locale === "ru" ? "en" : "ru" })
    const location = new URL(callback.headers.get("location")!, "http://localhost:3000")
    expect(location.searchParams.get("error")).toBe("oidc_access_denied")
    expect(location.searchParams.get("error_description")).toBe(errorMessage("auth.oidcAccessDenied", {}, locale))
  })

  it.each([undefined, "app-budget-admins", [mapping.adminGroup, 42], ["unrelated-app-admins"]])("denies malformed or unauthorized groups before creating a session: %j", async (groups) => {
    const incoming = profile(groups)
    const { callback, session } = await signIn(incoming)
    expect(session).toBeNull()
    expect(callback.headers.get("location")).toContain("error=oidc_access_denied")
    expect(await getDb().select().from(users).where(eq(users.email, incoming.email))).toHaveLength(0)
  })

  it("does not trust admin claims when the ID token fails nonce verification", async () => {
    const incoming = { ...profile([mapping.adminGroup]), nonce: "wrong-request-nonce" }
    const { session } = await signIn(incoming)
    expect(session).toBeNull()
    expect(await getDb().select().from(users).where(eq(users.email, incoming.email))).toHaveLength(0)
  })

  it("does not link or promote an unrelated local account with a matching email", async () => {
    const local = await createUser("Local account")
    const { session } = await signIn({ ...profile([mapping.adminGroup]), email: local.email })
    expect(session).toBeNull()
    const [unchanged] = await getDb().select().from(users).where(eq(users.id, local.id))
    expect(unchanged!.role).toBe("user")
    expect(await getDb().select().from(authAccounts).where(eq(authAccounts.userId, local.id))).toHaveLength(0)
  })

  it("keeps role server-owned on local registration", async () => {
    const auth = await getAuth()
    const response = await allowSignup(() => auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Local", email: `${randomUUID()}@local.test`, password: "local-password-12345", role: "admin" }),
    })))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: "FIELD_NOT_ALLOWED" })
  })

  it("does not change a local user's role when merely linking SSO", async () => {
    const auth = await getAuth()
    const email = `${randomUUID()}@link.test`
    const registered = await allowSignup(() => auth.handler(new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Local", email, password: "local-password-12345" }),
    })))
    expect(registered.status).toBe(200)
    const identity = { ...profile([mapping.adminGroup]), email }
    const started = await auth.handler(new Request("http://localhost:3000/api/auth/link-social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: cookieHeader(registered) },
      body: JSON.stringify({ provider: "oidc", callbackURL: "/settings" }),
    }))
    expect(started.status).toBe(200)
    const { url } = await started.json() as { url: string }
    const authorization = await fetch(authorizationUrl(url, identity), { redirect: "manual" })
    const callback = await auth.handler(new Request(authorization.headers.get("location")!, {
      headers: { cookie: `${cookieHeader(registered)}; ${cookieHeader(started)}` },
    }))
    expect(callback.headers.get("location")).toBe("/settings")
    const [user] = await getDb().select().from(users).where(eq(users.email, email))
    expect(user!.role).toBe("user")
    expect(await getDb().select().from(authAccounts).where(eq(authAccounts.userId, user!.id))).toHaveLength(2)
    expect((await signIn(identity)).session?.user.role).toBe("admin")
  })

  it("keeps the last active administrator, audits the refusal, and clears the warning after recovery", async () => {
    const incoming = profile([mapping.adminGroup])
    const first = await signIn(incoming)
    const id = first.session!.user.id
    const others = await getDb().select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.banned, false)))
    const otherIds = others.filter((user) => user.id !== id).map((user) => user.id)
    if (otherIds.length) await getDb().update(users).set({ banned: true }).where(inArray(users.id, otherIds))
    try {
      const deniedDemotion = await signIn({ ...incoming, groups: [mapping.userGroup] })
      expect(deniedDemotion.session?.user).toMatchObject({ id, role: "admin" })
      const events = await getDb().select().from(auditLogs).where(and(eq(auditLogs.action, "oidc.role_demotion_blocked"), eq(auditLogs.entityId, id)))
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ actorId: id, entityType: "user", householdId: null, meta: { adminGroup: mapping.adminGroup } })
      expect(await hasOidcRoleDemotionWarning()).toBe(true)
      const normal = await signIn(profile([mapping.userGroup]))
      expect(normal.session?.user.role).toBe("user")
      expect((await getDb().select().from(users).where(eq(users.id, id)))[0]?.role).toBe("admin")
      expect((await signIn(incoming)).session?.user.role).toBe("admin")
      expect(await hasOidcRoleDemotionWarning()).toBe(false)
      expect(await getDb().select().from(auditLogs).where(and(eq(auditLogs.action, "oidc.role_demotion_resolved"), eq(auditLogs.entityId, id)))).toMatchObject([
        { meta: { blockedEventId: events[0]!.id } },
      ])
    } finally {
      if (otherIds.length) await getDb().update(users).set({ banned: false }).where(inArray(users.id, otherIds))
    }
  })

  it("keeps one active administrator when two independent OIDC callbacks demote concurrently", async () => {
    const incoming = [profile([mapping.adminGroup]), profile([mapping.adminGroup])]
    const first = await signIn(incoming[0]!)
    const second = await signIn(incoming[1]!)
    const ids = [first.session!.user.id, second.session!.user.id]
    const others = await getDb().select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.banned, false)))
    const otherIds = others.filter((user) => !ids.includes(user.id)).map((user) => user.id)
    if (otherIds.length) await getDb().update(users).set({ banned: true }).where(inArray(users.id, otherIds))
    try {
      const results = await Promise.all(incoming.map((user) => signIn({ ...user, groups: [mapping.userGroup] })))
      expect(results.map((result) => result.session?.user.id).sort()).toEqual([...ids].sort())
      expect(results.map((result) => result.session?.user.role).sort()).toEqual(["admin", "user"])
      const active = await getDb().select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.banned, false)))
      expect(active).toHaveLength(1)
      expect(ids).toContain(active[0]!.id)
      expect(await getDb().select().from(auditLogs).where(and(eq(auditLogs.action, "oidc.role_demotion_blocked"), inArray(auditLogs.entityId, ids)))).toHaveLength(1)
      // Restore the admin group through the same callback path; it resolves the persisted warning.
      await signIn(incoming[ids.indexOf(active[0]!.id)]!)
      expect(await hasOidcRoleDemotionWarning()).toBe(false)
    } finally {
      if (otherIds.length) await getDb().update(users).set({ banned: false }).where(inArray(users.id, otherIds))
    }
  })

  it("leaves manual system roles unchanged when mapping is absent", async () => {
    delete process.env.OIDC_GROUPS_CLAIM
    delete process.env.OIDC_USER_GROUP
    delete process.env.OIDC_ADMIN_GROUP
    vi.resetModules()
    const fresh = await import("@/lib/auth")
    fresh.invalidateAuth()
    authFactory = fresh.getAuth
    const incoming = { ...profile(undefined), role: "admin" }
    const first = await signIn(incoming)
    expect(first.session?.user.role).toBe("user")
    await getDb().update(users).set({ role: "admin" }).where(eq(users.id, first.session!.user.id))
    expect((await signIn(incoming)).session?.user.role).toBe("admin")
  })
})
