import { ZodError } from "zod"

/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: "bad_request" | "forbidden" | "not_found" | "conflict" | "unauthorized" = "bad_request",
  ) {
    super(message)
    this.name = "AppError"
  }
}

export const forbidden = () => new AppError("Недостаточно прав для этого действия", "forbidden")
export const notFound = (message = "Запись не найдена") => new AppError(message, "not_found")
export const conflict = () =>
  new AppError("Данные были изменены другим участником. Обновите страницу и повторите.", "conflict")

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> }

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

/**
 * Runs a server action body and converts known errors into an ActionResult.
 * Unknown errors are logged without payloads (which may contain financial data) and hidden from the client.
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    if (isRedirectOrNotFound(err)) throw err
    if (err instanceof AppError) return { ok: false, error: err.message }
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of err.issues) {
        const key = issue.path.join(".")
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
      }
      return { ok: false, error: err.issues[0]?.message ?? "Проверьте введённые данные", fieldErrors }
    }
    const code = pgCode(err)
    if (code === "23505") return { ok: false, error: "Такая запись уже существует" }
    if (code === "23503") return { ok: false, error: "Запись используется или ссылается на несуществующие данные" }
    if (code === "40001") return { ok: false, error: "Конфликт параллельного изменения, повторите попытку" }
    console.error("[action] unexpected error:", err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "unknown")
    return { ok: false, error: "Что-то пошло не так. Попробуйте ещё раз." }
  }
}
