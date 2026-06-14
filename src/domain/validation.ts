import { formatDateKey } from "./format"

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DECIMAL_INPUT_PATTERN = /^\d+(?:[.,]\d+)?$/
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const MONEY_INPUT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/

export function trimText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback
}

export function isEmailLike(value: string) {
  return EMAIL_PATTERN.test(value.trim())
}

export function normalizeEmail(value: unknown) {
  const email = trimText(value).toLowerCase()

  return isEmailLike(email) ? email : null
}

export function normalizeHttpUrl(value: unknown) {
  const raw = trimText(value)

  if (!raw) {
    return null
  }

  try {
    const url = new URL(raw)

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null
    }

    url.hash = ""

    return url.toString()
  } catch {
    return null
  }
}

export function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const items: string[] = []

  value.forEach((item) => {
    const normalized = trimText(item)

    if (!normalized || seen.has(normalized)) {
      return
    }

    seen.add(normalized)
    items.push(normalized)
  })

  return items
}

export function normalizeScopeList(
  value: unknown,
  fallback = ["openid", "email", "profile"]
) {
  const rawItems = Array.isArray(value)
    ? value.flatMap((item) => trimText(item).split(/[\s,]+/))
    : trimText(value).split(/[\s,]+/)
  const seen = new Set<string>()
  const scopes = rawItems.flatMap((item) => {
    const scope = item.trim()

    if (!scope || seen.has(scope)) {
      return []
    }

    seen.add(scope)
    return [scope]
  })

  return scopes.length > 0 ? scopes : fallback
}

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) {
    return false
  }

  const date = new Date(`${value}T12:00:00`)

  return !Number.isNaN(date.getTime()) && formatDateKey(date) === value
}

export function normalizeDateKey(value: unknown, fallbackDate = new Date()) {
  return isValidDateKey(value) ? value : formatDateKey(fallbackDate)
}

export function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE_TIME_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).getTime())
  )
}

export function normalizeIsoDateTime(value: unknown, fallbackDate = new Date()) {
  return isIsoDateTime(value) ? value : fallbackDate.toISOString()
}

export function normalizeOptionalIsoDateTime(value: unknown) {
  return isIsoDateTime(value) ? value : undefined
}

export function parsePositiveMoneyInput(value: string) {
  const normalized = value.trim().replace(",", ".")

  if (!MONEY_INPUT_PATTERN.test(normalized)) {
    return null
  }

  return coercePositiveNumber(normalized)
}

export function parseNonNegativeDecimalInput(value: string) {
  const normalized = value.trim().replace(",", ".")

  if (!DECIMAL_INPUT_PATTERN.test(normalized)) {
    return null
  }

  return coerceNonNegativeNumber(normalized)
}

export function coercePositiveNumber(value: unknown) {
  const parsed = coerceNumber(value)

  return parsed !== null && parsed > 0 ? roundMoney(parsed) : null
}

export function coerceNonNegativeNumber(value: unknown) {
  const parsed = coerceNumber(value)

  return parsed !== null && parsed >= 0 ? roundMoney(parsed) : null
}

function coerceNumber(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim().replace(",", "."))
        : Number.NaN

  return Number.isFinite(parsed) ? parsed : null
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}
