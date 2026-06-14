import { describe, expect, it } from "vitest"

import {
  normalizeEmail,
  normalizeHttpUrl,
  normalizeOptionalIsoDateTime,
  normalizeScopeList,
  normalizeStringList,
} from "./validation"

describe("domain validation helpers", () => {
  it("normalizes emails and HTTP URLs for auth configuration", () => {
    expect(normalizeEmail(" ANNA@example.COM ")).toBe("anna@example.com")
    expect(normalizeEmail("not-an-email")).toBeNull()
    expect(normalizeHttpUrl("https://idp.example.com/auth#fragment")).toBe(
      "https://idp.example.com/auth"
    )
    expect(normalizeHttpUrl("javascript:alert(1)")).toBeNull()
  })

  it("deduplicates string lists and OIDC scopes", () => {
    expect(normalizeStringList([" finance ", "finance", "", 42])).toEqual([
      "finance",
    ])
    expect(normalizeScopeList("openid email profile email")).toEqual([
      "openid",
      "email",
      "profile",
    ])
    expect(normalizeScopeList("")).toEqual(["openid", "email", "profile"])
  })

  it("keeps only valid ISO date-time values", () => {
    expect(normalizeOptionalIsoDateTime("2026-06-01T00:00:00.000Z")).toBe(
      "2026-06-01T00:00:00.000Z"
    )
    expect(normalizeOptionalIsoDateTime("2026-06-01")).toBeUndefined()
  })
})
