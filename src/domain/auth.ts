import type { SsoLoginProfile } from "./storage"
import type { OidcProviderConfig, SsoClaimValue } from "./types"

const OIDC_PENDING_KEY = "bestbudget.oidc.pending.v1"

const OIDC_RESERVED_PARAMETERS = new Set([
  "client_id",
  "code_challenge",
  "code_challenge_method",
  "nonce",
  "redirect_uri",
  "response_mode",
  "response_type",
  "scope",
  "state",
])

export type OidcAuthorizationParams = {
  state: string
  nonce: string
  codeChallenge: string
  loginHint?: string
  prompt?: "none" | "login" | "consent" | "select_account"
  additionalParameters?: Record<string, string | undefined>
}

export type OidcCallbackResult =
  | { ok: true; code: string; state: string }
  | {
      ok: false
      error: string
      errorDescription?: string
      state?: string
    }

type OidcDiscovery = {
  issuer?: string
  authorization_endpoint?: string
  token_endpoint?: string
  userinfo_endpoint?: string
}

type PendingOidcRequest = {
  providerId: string
  state: string
  nonce: string
  codeVerifier: string
  redirectUri: string
  startedAt: number
}

export function createOidcCodeVerifier(byteLength = 32) {
  if (byteLength < 32 || byteLength > 96) {
    throw new Error("OIDC code verifier entropy must be between 32 and 96 bytes.")
  }

  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)

  return base64UrlEncode(bytes)
}

export function createOidcNonce() {
  return createOidcCodeVerifier(32)
}

export function createOidcState() {
  return createOidcCodeVerifier(32)
}

export async function createOidcCodeChallenge(verifier: string) {
  const bytes = new TextEncoder().encode(verifier)
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)

  return base64UrlEncode(new Uint8Array(digest))
}

export function buildOidcAuthorizationUrl(
  provider: OidcProviderConfig,
  params: OidcAuthorizationParams
) {
  if (!provider.authorizationEndpoint || !provider.redirectUri) {
    throw new Error("OIDC provider is missing authorization endpoint or redirect URI.")
  }

  const url = new URL(provider.authorizationEndpoint)

  url.searchParams.set("client_id", provider.clientId)
  url.searchParams.set("redirect_uri", provider.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", provider.scopes.join(" "))
  url.searchParams.set("state", params.state)
  url.searchParams.set("nonce", params.nonce)
  url.searchParams.set("code_challenge", params.codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("response_mode", provider.responseMode)

  if (params.loginHint) {
    url.searchParams.set("login_hint", params.loginHint)
  }

  if (params.prompt) {
    url.searchParams.set("prompt", params.prompt)
  }

  Object.entries(params.additionalParameters ?? {}).forEach(([key, value]) => {
    if (!value || OIDC_RESERVED_PARAMETERS.has(key)) {
      return
    }

    url.searchParams.set(key, value)
  })

  return url.toString()
}

export function getOidcRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`
}

export async function startOidcLogin(provider: OidcProviderConfig) {
  if (provider.type !== "oidc" || provider.status !== "enabled") {
    throw new Error("SSO-провайдер отключен.")
  }

  const discovery = await fetchOidcDiscovery(provider.issuer)
  const redirectUri = provider.redirectUri || getOidcRedirectUri()
  const state = createOidcState()
  const nonce = createOidcNonce()
  const codeVerifier = createOidcCodeVerifier()
  const codeChallenge = await createOidcCodeChallenge(codeVerifier)
  const authorizationUrl = buildOidcAuthorizationUrl(
    {
      ...provider,
      authorizationEndpoint: discovery.authorization_endpoint,
      redirectUri,
      scopes: ensureOpenIdScope(provider.scopes),
    },
    {
      state,
      nonce,
      codeChallenge,
    }
  )

  sessionStorage.setItem(
    OIDC_PENDING_KEY,
    JSON.stringify({
      providerId: provider.id,
      state,
      nonce,
      codeVerifier,
      redirectUri,
      startedAt: Date.now(),
    } satisfies PendingOidcRequest)
  )
  window.location.assign(authorizationUrl)
}

export async function finishOidcLogin(
  providers: OidcProviderConfig[],
  input = window.location.href
): Promise<SsoLoginProfile | null> {
  const callback = parseOidcCallback(input)

  if (!callback.ok && callback.error === "invalid_callback" && !callback.state) {
    return null
  }

  const pending = readPendingOidcRequest()

  if (!pending) {
    throw new Error("SSO-сессия не найдена. Попробуйте войти еще раз.")
  }

  if (!callback.ok) {
    clearPendingOidcRequest()
    throw new Error(callback.errorDescription || callback.error)
  }

  if (callback.state !== pending.state) {
    clearPendingOidcRequest()
    throw new Error("SSO state не совпал. Попробуйте войти еще раз.")
  }

  const provider = providers.find(
    (item) => item.id === pending.providerId && item.type === "oidc"
  )

  if (!provider || provider.status !== "enabled") {
    clearPendingOidcRequest()
    throw new Error("SSO-провайдер не найден или отключен.")
  }

  const discovery = await fetchOidcDiscovery(provider.issuer)
  const tokenEndpoint =
    typeof discovery.token_endpoint === "string" ? discovery.token_endpoint : ""

  if (!tokenEndpoint) {
    clearPendingOidcRequest()
    throw new Error("OIDC discovery не содержит token endpoint.")
  }

  const tokenResponse = await exchangeOidcCode(
    tokenEndpoint,
    provider.clientId,
    pending,
    callback.code
  )
  const idClaims = parseJwtClaims(tokenResponse.id_token)

  if (idClaims.nonce !== pending.nonce) {
    clearPendingOidcRequest()
    throw new Error("SSO nonce не совпал. Попробуйте войти еще раз.")
  }

  const userInfo =
    tokenResponse.access_token && discovery.userinfo_endpoint
      ? await fetchOidcUserInfo(discovery.userinfo_endpoint, tokenResponse.access_token)
      : {}
  const claims = {
    ...idClaims,
    ...userInfo,
  }

  if (claims.email_verified === false) {
    clearPendingOidcRequest()
    throw new Error("IdP вернул неподтвержденный email.")
  }

  const subject = stringifyClaim(claims.sub)
  const email = stringifyClaim(claims.email)
  const name =
    stringifyClaim(claims.name) ||
    stringifyClaim(claims.preferred_username) ||
    email.split("@")[0]

  if (!subject || !email) {
    clearPendingOidcRequest()
    throw new Error("IdP не вернул обязательные claims: sub и email.")
  }

  clearPendingOidcRequest()
  clearOidcCallbackUrl()

  return {
    providerId: provider.id,
    subject,
    email,
    name,
    groups: uniqueStrings(readClaimValues(claims, "groups")),
    roles: uniqueStrings([
      ...readClaimValues(claims, provider.roleClaim),
      ...readClaimValues(claims, "roles"),
      ...readClaimValues(claims, "realm_access.roles"),
    ]),
    claims: sanitizeClaims(claims),
    expiresAt: extractExpiry(claims.exp),
  }
}

export function parseOidcCallback(input: string): OidcCallbackResult {
  const params = parseCallbackParams(input)
  const error = params.get("error")
  const state = params.get("state") ?? undefined

  if (error) {
    return {
      ok: false,
      error,
      errorDescription: params.get("error_description") ?? undefined,
      state,
    }
  }

  const code = params.get("code")

  if (!code || !state) {
    return {
      ok: false,
      error: "invalid_callback",
      errorDescription: "OIDC callback is missing code or state.",
      state,
    }
  }

  return { ok: true, code, state }
}

function parseCallbackParams(input: string) {
  try {
    const url = new URL(input)

    return url.searchParams
  } catch {
    return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)
  }
}

async function fetchOidcDiscovery(issuer: string) {
  const discoveryUrl = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`
  const response = await fetch(discoveryUrl, {
    headers: { Accept: "application/json" },
  })

  if (!response.ok) {
    throw new Error("Не удалось получить OIDC discovery metadata.")
  }

  const metadata = (await response.json()) as OidcDiscovery

  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new Error("OIDC discovery не содержит authorization/token endpoints.")
  }

  return metadata as Required<Pick<OidcDiscovery, "authorization_endpoint" | "token_endpoint">> &
    OidcDiscovery
}

async function exchangeOidcCode(
  tokenEndpoint: string,
  clientId: string,
  pending: PendingOidcRequest,
  code: string
): Promise<{ access_token?: string; id_token: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: pending.redirectUri,
    code,
    code_verifier: pending.codeVerifier,
  })
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  })

  if (!response.ok) {
    throw new Error("IdP отклонил обмен authorization code.")
  }

  const data = (await response.json()) as {
    access_token?: string
    id_token?: string
  }

  if (!data.id_token) {
    throw new Error("IdP не вернул id_token.")
  }

  return {
    access_token: data.access_token,
    id_token: data.id_token,
  }
}

async function fetchOidcUserInfo(userInfoEndpoint: string, accessToken: string) {
  const response = await fetch(userInfoEndpoint, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    return {}
  }

  return (await response.json()) as Record<string, unknown>
}

function readPendingOidcRequest(): PendingOidcRequest | null {
  try {
    const raw = sessionStorage.getItem(OIDC_PENDING_KEY)
    const record = raw ? (JSON.parse(raw) as Partial<PendingOidcRequest>) : null

    if (
      !record?.providerId ||
      !record.state ||
      !record.nonce ||
      !record.codeVerifier ||
      !record.redirectUri ||
      !record.startedAt ||
      Date.now() - record.startedAt > 10 * 60 * 1000
    ) {
      return null
    }

    return record as PendingOidcRequest
  } catch {
    return null
  }
}

function clearPendingOidcRequest() {
  sessionStorage.removeItem(OIDC_PENDING_KEY)
}

function clearOidcCallbackUrl() {
  const cleanUrl = `${window.location.pathname}${window.location.hash}`
  window.history.replaceState({}, document.title, cleanUrl)
}

function parseJwtClaims(token: string) {
  const [, payload] = token.split(".")

  if (!payload) {
    throw new Error("IdP вернул некорректный id_token.")
  }

  const decoded = base64UrlDecode(payload)

  return JSON.parse(decoded) as Record<string, unknown>
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  )
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))

  return new TextDecoder().decode(bytes)
}

function ensureOpenIdScope(scopes: string[]) {
  return scopes.includes("openid") ? scopes : ["openid", ...scopes]
}

function readClaimValues(claims: Record<string, unknown>, path: string) {
  const value = path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, key) => {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return undefined
      }

      return (current as Record<string, unknown>)[key]
    }, claims)

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = stringifyClaim(item)
      return text ? [text] : []
    })
  }

  const text = stringifyClaim(value)
  return text ? [text] : []
}

function stringifyClaim(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : ""
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>()
  return values.flatMap((value) => {
    const normalized = value.trim()
    const key = normalized.toLowerCase()

    if (!normalized || seen.has(key)) {
      return []
    }

    seen.add(key)
    return [normalized]
  })
}

function sanitizeClaims(claims: Record<string, unknown>) {
  return Object.entries(claims).reduce<Record<string, SsoClaimValue>>(
    (safeClaims, [key, value]) => {
      if (
        value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        safeClaims[key] = value
        return safeClaims
      }

      if (Array.isArray(value)) {
        safeClaims[key] = value.flatMap((item) => {
          const text = stringifyClaim(item)
          return text ? [text] : []
        })
        return safeClaims
      }

      if (value && typeof value === "object") {
        safeClaims[key] = value as Record<string, unknown>
      }

      return safeClaims
    },
    {}
  )
}

function extractExpiry(value: unknown) {
  return typeof value === "number"
    ? new Date(value * 1000).toISOString()
    : undefined
}

function base64UrlEncode(bytes: Uint8Array) {
  const binary = String.fromCharCode(...bytes)

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}
