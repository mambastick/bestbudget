import { describe, expect, it } from "vitest"

import {
  buildOidcAuthorizationUrl,
  createOidcCodeChallenge,
  createOidcCodeVerifier,
  parseOidcCallback,
} from "./auth"
import type { OidcProviderConfig } from "./types"

const provider: OidcProviderConfig = {
  id: "provider_oidc",
  workspaceId: "workspace_family",
  type: "oidc",
  providerKind: "oidc",
  name: "Workspace IdP",
  status: "enabled",
  issuer: "https://idp.example.com/",
  clientId: "bestbudget-spa",
  authorizationEndpoint: "https://idp.example.com/oauth2/authorize",
  redirectUri: "https://app.example.com/auth/callback",
  scopes: ["openid", "email", "profile"],
  responseType: "code",
  responseMode: "query",
  pkce: true,
  roleClaim: "realm_access.roles",
  defaultRole: "member",
  allowOwnerRoleMapping: false,
  createdAt: "2026-06-01T00:00:00.000Z",
}

describe("OIDC helpers", () => {
  it("creates PKCE verifier material and the expected S256 challenge", async () => {
    const verifier = createOidcCodeVerifier()

    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    await expect(
      createOidcCodeChallenge(
        "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
      )
    ).resolves.toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  })

  it("builds authorization code URLs with PKCE and ignores reserved overrides", () => {
    const url = new URL(
      buildOidcAuthorizationUrl(provider, {
        state: "state_123",
        nonce: "nonce_123",
        codeChallenge: "challenge_123",
        loginHint: "anna@example.com",
        prompt: "select_account",
        additionalParameters: {
          access_type: "offline",
          client_id: "attacker",
        },
      })
    )

    expect(url.origin).toBe("https://idp.example.com")
    expect(url.searchParams.get("client_id")).toBe("bestbudget-spa")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBe("challenge_123")
    expect(url.searchParams.get("scope")).toBe("openid email profile")
    expect(url.searchParams.get("access_type")).toBe("offline")
    expect(url.searchParams.get("login_hint")).toBe("anna@example.com")
    expect(url.searchParams.get("prompt")).toBe("select_account")
  })

  it("parses successful and error callbacks", () => {
    expect(
      parseOidcCallback(
        "https://app.example.com/auth/callback?code=abc&state=state_123"
      )
    ).toEqual({
      ok: true,
      code: "abc",
      state: "state_123",
    })
    expect(
      parseOidcCallback(
        "?error=access_denied&error_description=Nope&state=state_123"
      )
    ).toEqual({
      ok: false,
      error: "access_denied",
      errorDescription: "Nope",
      state: "state_123",
    })
    expect(parseOidcCallback("?state=state_123")).toMatchObject({
      ok: false,
      error: "invalid_callback",
    })
  })
})
