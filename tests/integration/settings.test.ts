import { eq } from "drizzle-orm"
import { afterAll, afterEach, describe, expect, it } from "vitest"
import { closeDb, getDb } from "@/db"
import { applicationSettings, authAccounts, oidcProviderSettings } from "@/db/schema"
import { decryptSecret, encryptSecret, hashToken } from "@/lib/crypto"
import { getAuthMethods, getOidcConfig, updateAuthSettings, updateOidcSettings } from "@/server/services/settings"
import { createUser } from "./helpers"

afterAll(async () => {
  await closeDb()
})

afterEach(async () => {
  await getDb().delete(oidcProviderSettings)
  await getDb().delete(applicationSettings)
})

const oidc = {
  enabled: true,
  displayName: "Keycloak",
  issuerUrl: "https://id.example.test/realms/family",
  clientId: "bestbudget",
  clientSecret: "super-secret-value",
  scopes: "profile email",
  allowSignup: false,
}

describe("secrets", () => {
  it("encrypts with authenticated encryption and never stores plaintext", async () => {
    const admin = await createUser("Admin")
    await updateOidcSettings(admin.id, oidc)
    const [row] = await getDb().select().from(oidcProviderSettings)
    expect(row!.clientSecretEncrypted).not.toContain("super-secret-value")
    expect(decryptSecret(row!.clientSecretEncrypted!)).toBe("super-secret-value")

    const tampered = row!.clientSecretEncrypted!.slice(0, -2) + (row!.clientSecretEncrypted!.endsWith("A") ? "BB" : "AA")
    expect(() => decryptSecret(tampered)).toThrow()
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"))
    expect(hashToken("abc")).toHaveLength(64)
  })

  it("keeps the stored secret when the form leaves it empty and always requests openid", async () => {
    const admin = await createUser("Admin")
    await updateOidcSettings(admin.id, oidc)
    await updateOidcSettings(admin.id, { ...oidc, clientSecret: "", displayName: "SSO" })
    const config = await getOidcConfig()
    expect(config).toMatchObject({ source: "db", displayName: "SSO", clientSecret: "super-secret-value" })
    expect(config!.scopes).toEqual(["openid", "profile", "email"])
    expect(config!.redirectUri).toBe("http://localhost:3000/api/auth/callback/oidc")
  })
})

describe("lock-out protection", () => {
  it("keeps password login when SSO is not configured", async () => {
    const admin = await createUser("Admin")
    await expect(updateAuthSettings(admin.id, { appName: "BB", localAuthEnabled: false, publicRegistration: false })).rejects.toThrow(
      /SSO не настроен/,
    )
  })

  it("requires the admin's own linked SSO identity before disabling passwords", async () => {
    const admin = await createUser("Admin")
    await updateOidcSettings(admin.id, oidc)
    await expect(updateAuthSettings(admin.id, { appName: "BB", localAuthEnabled: false, publicRegistration: false })).rejects.toThrow(
      /привяжите SSO/,
    )
    await getDb().insert(authAccounts).values({ userId: admin.id, providerId: "oidc", accountId: "admin-sub" })
    await updateAuthSettings(admin.id, { appName: "BB", localAuthEnabled: false, publicRegistration: false })
    expect((await getAuthMethods()).local).toBe(false)

    // SSO cannot then be switched off as well.
    await expect(updateOidcSettings(admin.id, { ...oidc, enabled: false })).rejects.toThrow(/Нельзя отключить SSO/)
  })

  it("falls back to password login whenever SSO becomes unusable", async () => {
    const admin = await createUser("Admin")
    await updateOidcSettings(admin.id, oidc)
    await getDb().insert(authAccounts).values({ userId: admin.id, providerId: "oidc", accountId: "admin-sub-2" })
    await updateAuthSettings(admin.id, { appName: "BB", localAuthEnabled: false, publicRegistration: false })
    // e.g. the provider row is removed or disabled directly in the database
    await getDb().update(oidcProviderSettings).set({ enabled: false }).where(eq(oidcProviderSettings.id, 1))
    expect(await getAuthMethods()).toMatchObject({ local: true, oidc: null })
  })

  it("public registration is off by default", async () => {
    expect((await getAuthMethods()).publicRegistration).toBe(false)
  })
})
