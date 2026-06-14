import { formatDateKey } from "./format"

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DECIMAL_INPUT_PATTERN = /^\d+(?:[.,]\d+)?$/
const MONEY_INPUT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/

export function trimText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback
}

export function isEmailLike(value: string) {
  return EMAIL_PATTERN.test(value.trim())
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
