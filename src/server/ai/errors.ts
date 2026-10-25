import "server-only"
import { APICallError, ToolChoiceViolationError, UnsupportedFunctionalityError } from "ai"
import type { AiDiagnostic, AiErrorCode } from "@/domain/ai/diagnostics"
import { AppError } from "@/server/errors"

function providerMessage(body: string | undefined): string {
  if (!body) return ""
  try {
    const parsed = JSON.parse(body)
    const message = parsed?.error?.message ?? parsed?.message ?? parsed?.error
    return typeof message === "string" ? message : ""
  } catch {
    // Never display an HTML error page, request dump or arbitrary JSON fields.
    return ["<", "{", "["].some((prefix) => body.trim().startsWith(prefix)) ? "" : body
  }
}

export function sanitizeProviderMessage(message: string, secrets: string[] = []): string {
  let safe = message
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const variant of new Set([secret, encodeURIComponent(secret)])) safe = safe.split(variant).join("[redacted]")
  }
  return safe
    .replace(/(?:request|response)?[ _-]?headers\s*[:=][\s\S]*/gi, "[redacted]")
    .replace(/(?:authorization|proxy-authorization|x-api-key|api[-_ ]?key|access[-_ ]?token|cookie|set-cookie)\s*["']?\s*[:=]\s*[^\r\n]+/gi, "[redacted]")
    .replace(/(?:^|[\r\n])\s*[a-z][a-z0-9-]*:\s*[^\r\n]+/gi, " ")
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;"']+/gi, "[redacted]")
    .replace(/\b(?:sk-|AIza)[a-zA-Z0-9_-]+/g, "[redacted]")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[url]")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ").trim().slice(0, 300)
}

export function classifyAiError(error: unknown, secrets: string[] = []): AiDiagnostic {
  if (error instanceof AppError && error.diagnostic) return error.diagnostic
  const chain: unknown[] = []
  let current = error
  while (current && chain.length < 8 && !chain.includes(current)) {
    chain.push(current)
    current = typeof current === "object" && "cause" in current ? current.cause : undefined
  }
  const api = chain.find((e) => APICallError.isInstance(e)) as APICallError | undefined
  const status = api?.statusCode ?? null
  const message = providerMessage(api?.responseBody)
  let code: AiErrorCode = "ai.connectionFailed"
  if (status === 401 || status === 403) code = "ai.keyRejected"
  else if (status === 402) code = "ai.noCredits"
  else if (status === 404) code = "ai.modelNotFound"
  else if (status === 400 && /tools?|tool[_ -]?choice|function[_ -]?(?:call|calling)/i.test(api?.responseBody?.slice(0, 16_384) || api?.message || "")) code = "ai.noTools"
  else if (status === 429) code = "ai.rateLimited"
  else if (status !== null && status >= 500) code = "ai.unavailable"
  else if (chain.some((e) => ToolChoiceViolationError.isInstance(e) || UnsupportedFunctionalityError.isInstance(e))) code = "ai.noTools"
  else if (status === null && chain.some((e) => e instanceof Error && /fetch failed|network|timeout|timed? ?out|abort|ENOTFOUND|EAI_AGAIN|ECONN|CERT|TLS|SSL/i.test(`${e.name} ${e.message} ${"code" in e ? e.code : ""}`))) code = "ai.networkError"
  return { code, status, message: sanitizeProviderMessage(message, secrets) }
}

export function aiProviderError(error: unknown, secrets: string[] = []): AppError {
  if (error instanceof AppError) return error
  const diagnostic = classifyAiError(error, secrets)
  console.error(`[ai] ${diagnostic.code} status=${diagnostic.status ?? "none"}`)
  return new AppError(diagnostic.code, {}, "bad_request", diagnostic)
}
