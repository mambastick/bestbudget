import { describe, expect, it } from "vitest"
import { roleFromOidcGroups } from "./oidc-roles"

const mapping = { claim: "groups", userGroup: "app-budget-users", adminGroup: "app-budget-admins" }

describe("OIDC system roles", () => {
  it("accepts either app group, with admin precedence and no duplicate membership requirement", () => {
    expect(roleFromOidcGroups({ groups: [mapping.userGroup] }, mapping)).toBe("user")
    expect(roleFromOidcGroups({ groups: [mapping.adminGroup] }, mapping)).toBe("admin")
    expect(roleFromOidcGroups({ groups: [mapping.userGroup, mapping.adminGroup] }, mapping)).toBe("admin")
  })

  it.each([undefined, {}, { groups: null }, { groups: "app-budget-admins" }, { groups: [mapping.adminGroup, 1] },
    { groups: [] }, { groups: ["admins"] }, { groups: ["APP-BUDGET-ADMINS"] }, { role: "admin" },
    { groups: { [mapping.adminGroup]: true } }])("rejects an absent, malformed or unauthorized claim: %j", (profile) => {
    expect(roleFromOidcGroups(profile, mapping)).toBeNull()
  })

  it("reads only the configured literal top-level claim", () => {
    expect(roleFromOidcGroups({ groups: [mapping.adminGroup], bb_groups: [mapping.userGroup] }, { ...mapping, claim: "bb_groups" })).toBe("user")
  })
})
