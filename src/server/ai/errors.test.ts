import { APICallError } from "ai"
import { describe, expect, it, vi } from "vitest"
import { errorMessage } from "@/i18n/errors"
import { aiProviderError, classifyAiError, sanitizeProviderMessage } from "./errors"

function apiError(statusCode: number, message: string) {
  return new APICallError({
    message, statusCode, url: "https://provider.invalid/v1", requestBodyValues: { apiKey: "do-not-expose" },
    responseHeaders: { Authorization: "do-not-expose" }, responseBody: JSON.stringify({ error: { message } }),
  })
}

describe("AI provider diagnostics", () => {
  it.each([
    [401, "Invalid key", "ai.keyRejected"], [403, "Forbidden", "ai.keyRejected"],
    [402, "Insufficient credits", "ai.noCredits"], [404, "Missing model", "ai.modelNotFound"],
    [400, "tools are not supported", "ai.noTools"], [400, "unsupported tool_choice", "ai.noTools"],
    [400, "Invalid temperature", "ai.connectionFailed"], [429, "Rate limit", "ai.rateLimited"],
    [500, "Internal error", "ai.unavailable"], [503, "Unavailable", "ai.unavailable"],
  ] as const)("classifies HTTP %s (%s)", (status, message, code) => {
    expect(classifyAiError(apiError(status, message))).toEqual({ code, status, message })
    expect(errorMessage(code, {}, "ru")).not.toBe(errorMessage(code, {}, "en"))
  })
  it.each([
    new DOMException("Timed out", "TimeoutError"),
    new TypeError("fetch failed", { cause: Object.assign(new Error("DNS failure"), { code: "ENOTFOUND" }) }),
    new Error("certificate has expired", { cause: Object.assign(new Error("TLS failure"), { code: "CERT_HAS_EXPIRED" }) }),
    new APICallError({ message: "Request failed", url: "https://provider.invalid", requestBodyValues: {}, cause: new DOMException("Aborted", "AbortError") }),
  ])("classifies network failures without exposing system messages", (error) => {
    expect(classifyAiError(error)).toEqual({ code: "ai.networkError", status: null, message: "" })
  })
  it("recognizes tool errors nested in provider metadata without exposing metadata", () => {
    const error = apiError(400, "Provider returned error")
    const nested = new APICallError({ ...error, responseBody: JSON.stringify({ error: { message: "Provider returned error", metadata: { raw: "tool_choice unsupported", headers: { secret: "hidden" } } } }) })
    expect(classifyAiError(nested)).toEqual({ code: "ai.noTools", status: 400, message: "Provider returned error" })
  })
  it("finds an SDK error nested in a cause", () => {
    expect(classifyAiError(new Error("Wrapper", { cause: apiError(401, "Rejected") })).status).toBe(401)
  })
  it("removes secrets, URLs, header lines and controls before truncation", () => {
    const message = 'Rejected secret+key and secret%2Bkey sk-or-v1-sensitive Bearer token\nAuthorization: Basic sensitive\nX-Custom: header-value\nhttps://host.invalid/?key=secret\u0000 ' + "x".repeat(400)
    const safe = sanitizeProviderMessage(message, ["secret+key"])
    expect(safe.length).toBeLessThanOrEqual(300)
    expect(sanitizeProviderMessage("x".repeat(400))).toHaveLength(300)
    for (const sensitive of ["secret", "sensitive", "header-value", "host.invalid", "Authorization", "Bearer", "\n"]) expect(safe).not.toContain(sensitive)
  })
  it("only extracts the message field; never dumps JSON or HTML", () => {
    const error = apiError(401, "Rejected")
    for (const body of ['{"headers":{"Authorization":"hidden"}}', '<html>hidden</html>', 'null']) {
      expect(classifyAiError(new APICallError({ ...error, responseBody: body })).message).toBe("")
    }
  })
  it("logs only the classified code and status", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const failure = aiProviderError(apiError(401, "secret+key"), ["secret+key"])
      expect(failure.diagnostic?.message).toBe("[redacted]")
      expect(log.mock.calls).toEqual([["[ai] ai.keyRejected status=401"]])
    } finally { log.mockRestore() }
  })
})
