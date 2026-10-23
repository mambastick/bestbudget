import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => vi.unstubAllEnvs())

async function mappingEnv(claim = "", users = "", admins = "") {
  vi.stubEnv("OIDC_GROUPS_CLAIM", claim)
  vi.stubEnv("OIDC_USER_GROUP", users)
  vi.stubEnv("OIDC_ADMIN_GROUP", admins)
  vi.resetModules()
  return (await import("./env")).env
}

describe("OIDC role mapping configuration", () => {
  it("is optional", async () => {
    expect((await mappingEnv())()).toMatchObject({ OIDC_GROUPS_CLAIM: undefined, OIDC_USER_GROUP: undefined, OIDC_ADMIN_GROUP: undefined })
  })

  it.each([["groups", "", ""], ["groups", "users", ""], ["", "users", "admins"]])("rejects partial configuration", async (claim, users, admins) => {
    expect(await mappingEnv(claim, users, admins)).toThrow(/together/)
  })

  it("rejects identical user and admin groups", async () => {
    expect(await mappingEnv("groups", "same", "same")).toThrow(/differ/)
  })

  it("accepts three distinct configured values", async () => {
    expect((await mappingEnv("groups", "app-users", "app-admins"))()).toMatchObject({ OIDC_GROUPS_CLAIM: "groups", OIDC_USER_GROUP: "app-users", OIDC_ADMIN_GROUP: "app-admins" })
  })
})
