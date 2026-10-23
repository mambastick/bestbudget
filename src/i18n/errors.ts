import { createTranslator } from "next-intl"
import type { z } from "zod"
import enZod from "zod/v4/locales/en.js"
import ruZod from "zod/v4/locales/ru.js"
import en from "../../messages/en/errors.json"
import ru from "../../messages/ru/errors.json"

type Leaves<T> = { [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}` }[keyof T & string]
export type ErrorKey = Leaves<typeof en>
export type ErrorParams = Record<string, string | number>

export function errorTranslator(locale: string) {
  return createTranslator({ locale, messages: locale.startsWith("ru") ? ru : en })
}

export function errorMessage(key: ErrorKey, params: ErrorParams = {}, locale = "ru") {
  return errorTranslator(locale)(key, params)
}

/** Localize issue metadata at the response boundary; never mutate Zod's process-wide configuration. */
export function zodIssueMessage(issue: z.core.$ZodIssue, locale: string): string {
  const t = errorTranslator(locale)
  const key = issue.message as ErrorKey
  if (t.has(key)) return t(key)
  if (issue.code === "invalid_type") return t("validation.invalidType")
  return (locale.startsWith("ru") ? ruZod() : enZod()).localeError({ ...issue, input: undefined } as Parameters<z.core.$ZodErrorMap>[0]) as string
}

/** Pure domain errors retain a diagnostic message and carry a translatable identity to the server boundary. */
export class LocalizedError extends Error {
  constructor(readonly messageKey: ErrorKey, readonly params: ErrorParams = {}) {
    super(errorMessage(messageKey, params))
  }
}
