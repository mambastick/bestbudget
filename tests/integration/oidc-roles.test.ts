import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { OAuth2Server } from "oauth2-mock-server"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { closeDb, getDb } from "@/db"
import { authAccounts, householdMembers, users } from "@/db/schema"
import { allowSignup, getAuth, invalidateAuth } from "@/lib/auth"
import { createHousehold } from "@/server/services/households"
import { updateOidcSettings } from "@/server/services/settings"
import { createUser } from "./helpers"
import { errorMessage } from "@/i18n/errors"
import { setUserLocale } from "@/server/services/preferences"

const mapping = { claim: "groups", userGroup: "app-budget-users", adminGroup: "app-budget-admins" }
const idp = new OAuth2Server()
let identity: Record<string, unknown> = {}
let authFactory = getAuth

beforeAll(async () => {
  process.env.OIDC_GROUPS_CLAIM = mapping.claim
  process.env.OIDC_USER_GROUP = mapping.userGroup
  process.env.OIDC_ADMIN_GROUP = mapping.adminGroup
  await idp.issuer.keys.generate("RS256")
  await idp.start(0, "127.0.0.1")
  idp.service.on("beforeTokenSigning", (token) => Object.assign(token.payload, identity))
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

async function signIn(profile: Record<string, unknown>, headers: Record<string, string> = {}) {
  identity = profile
  const auth = await authFactory()
  const started = await auth.handler(new Request("http://localhost:3000/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify({ provider: "oidc", callbackURL: "/dashboard", errorCallbackURL: "/login", disableRedirect: true }),
  }))
  expect(started.status).toBe(200)
  const { url } = await started.json() as { url: string }
  const authorization = await fetch(url, { redirect: "manual" })
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
    identity = { ...profile([mapping.adminGroup]), email }
    const started = await auth.handler(new Request("http://localhost:3000/api/auth/link-social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: cookieHeader(registered) },
      body: JSON.stringify({ provider: "oidc", callbackURL: "/settings" }),
    }))
    expect(started.status).toBe(200)
    const { url } = await started.json() as { url: string }
    const authorization = await fetch(url, { redirect: "manual" })
    const callback = await auth.handler(new Request(authorization.headers.get("location")!, {
      headers: { cookie: `${cookieHeader(registered)}; ${cookieHeader(started)}` },
    }))
    expect(callback.headers.get("location")).toBe("/settings")
    const [user] = await getDb().select().from(users).where(eq(users.email, email))
    expect(user!.role).toBe("user")
    expect(await getDb().select().from(authAccounts).where(eq(authAccounts.userId, user!.id))).toHaveLength(2)
    expect((await signIn(identity)).session?.user.role).toBe("admin")
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
