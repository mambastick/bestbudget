import type { AiDiagnostic } from "@/domain/ai/diagnostics"
import { ZodError } from "zod"
import { cookies, headers } from "next/headers"
import { LOCALE_COOKIE, resolveLocale } from "@/i18n/locale"
import { getLocale } from "next-intl/server"
import { errorMessage, zodIssueMessage, type ErrorKey, type ErrorParams } from "@/i18n/errors"

/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(
    readonly messageKey: ErrorKey,
    readonly params: ErrorParams = {},
    readonly code: "bad_request" | "forbidden" | "not_found" | "conflict" | "unauthorized" = "bad_request",
    readonly diagnostic?: AiDiagnostic,
  ) {
    // Preserve the diagnostic message used by service callers; responses use the request locale.
    super(errorMessage(messageKey, params))
    this.name = "AppError"
  }
}

export const forbidden = () => new AppError("forbidden", {}, "forbidden")
export const notFound = (key: ErrorKey = "notFound", params: ErrorParams = {}) => new AppError(key, params, "not_found")
export const conflict = () =>
  new AppError("conflict", {}, "conflict")

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string>; diagnostic?: AiDiagnostic }

function isRedirectOrNotFound(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
}

/** Postgres error codes we translate into user-facing messages. */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null
  const code = e?.code ?? e?.cause?.code
  return typeof code === "string" ? code : undefined
}

/** Error rendering must still work if loading the session/preference failed with the action. */
async function errorLocale() {
  try { return await getLocale() } catch {
    try {
      return resolveLocale({ cookie: (await cookies()).get(LOCALE_COOKIE)?.value, acceptLanguage: (await headers()).get("accept-language") })
    } catch { return "en" }
  }
}

/**
 * Runs a server action body and converts known errors into an ActionResult.
 * Unknown errors are logged without payloads (which may contain financial data) and hidden from the client.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    if (isRedirectOrNotFound(err)) throw err
    const locale = await errorLocale()
    if (err instanceof AppError) return { ok: false, error: errorMessage(err.messageKey, err.params, locale), ...(err.diagnostic ? { diagnostic: err.diagnostic } : {}) }
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of err.issues) {
        const key = issue.path.join(".")
        if (key && !fieldErrors[key]) fieldErrors[key] = zodIssueMessage(issue, locale)
      }
      return { ok: false, error: err.issues[0] ? zodIssueMessage(err.issues[0], locale) : errorMessage("validation.invalid", {}, locale), fieldErrors }
    }
    const code = pgCode(err)
    if (code === "23505") return { ok: false, error: errorMessage("duplicate", {}, locale) }
    if (code === "23503") return { ok: false, error: errorMessage("reference", {}, locale) }
    if (code === "40001") return { ok: false, error: errorMessage("concurrent", {}, locale) }
    // Only the error type and SQLSTATE: messages of query errors contain parameters (amounts, e-mails).
    console.error(`[action] unexpected error: ${err instanceof Error ? err.name : "unknown"}${code ? ` (SQLSTATE ${code})` : ""}`)
    return { ok: false, error: errorMessage("unexpected", {}, locale) }
  }
}
