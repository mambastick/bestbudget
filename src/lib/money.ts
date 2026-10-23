import ru from "../../messages/ru/common.json"
import en from "../../messages/en/common.json"
import { currencyExponent } from "./currencies"

/**
 * Money is stored as integer minor units (kopecks for RUB) in BIGINT columns
 * and handled as JS numbers, which are exact up to 2^53 (≈ 90 trillion rubles).
 */

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, fractionDigits: number, locale: string) {
  const key = `${locale}:${currency}:${fractionDigits}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
    formatters.set(key, f)
  }
  return f
}

/** Formats minor units as a localized amount. Fractional minor units are shown only when present. */
export function formatMoney(minor: number, currency = "RUB", opts: { sign?: boolean; locale?: string } = {}): string {
  const exponent = currencyExponent(currency)
  const scale = 10 ** exponent
  const digits = minor % scale === 0 ? 0 : exponent
  const text = formatter(currency, digits, opts.locale ?? "ru").format(Math.abs(minor) / scale)
  if (minor < 0) return `−${text}`
  if (opts.sign && minor > 0) return `+${text}`
  return text
}

/** Compact form for chart axes: 150 000 → "150 тыс." */
export function formatMoneyCompact(minor: number, currency = "RUB", locale = "ru"): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(minor / 10 ** currencyExponent(currency))
}

/** Formats minor units for an editable input: 1234550 → "12345,50" (grouping is added by the input). */
export function minorToInput(minor: number, currency = "RUB", locale = "ru"): string {
  const abs = Math.abs(minor)
  const exponent = currencyExponent(currency)
  const scale = 10 ** exponent
  const rub = Math.floor(abs / scale)
  const kop = abs % scale
  return `${minor < 0 ? "-" : ""}${rub}${kop ? (locale.startsWith("ru") ? "," : ".") + String(kop).padStart(exponent, "0") : ""}`
}

/** A lone dot/comma is decimal. With both, the last is decimal and the other must group triples. */
export function normalizeMoneySeparators(input: string): string | null {
  let normalized = input.replace(/[\s\u00a0\u2009\u202f₽]/g, "")
  if (normalized.includes(",") && normalized.includes(".")) {
    const decimal = normalized.lastIndexOf(",") > normalized.lastIndexOf(".") ? "," : "."
    const group = decimal === "," ? "." : ","
    const parts = normalized.split(decimal)
    if (parts.length !== 2 || !new RegExp(`^\\d{1,3}(\\${group}\\d{3})+$`).test(parts[0]!)) return null
    normalized = parts[0]!.split(group).join("") + "." + parts[1]
  } else normalized = normalized.replace(",", ".")
  return normalized
}

/** Parse non-negative minor units; reject ambiguous grouping, excess decimals and unsafe integers. */
export function parseMoney(input: string, currency = "RUB"): number | null {
  const normalized = normalizeMoneySeparators(input)
  if (normalized === null) return null
  const exponent = currencyExponent(currency)
  if (!new RegExp(`^\\d+${exponent ? `(\\.\\d{0,${exponent}})?` : ""}$`).test(normalized)) return null
  const [whole = "0", frac = ""] = normalized.split(".")
  const minor = Number(whole) * 10 ** exponent + Number(frac.padEnd(exponent, "0"))
  return Number.isSafeInteger(minor) ? minor : null
}

/** Dense calendar labels use Intl for numbers and short localized magnitude suffixes. */
export function formatMoneyShort(minor: number, currency = "RUB", locale = "ru"): string {
  const amount = Math.round(Math.abs(minor) / 10 ** currencyExponent(currency))
  const labels = locale.startsWith("ru") ? ru.shortMoney : en.shortMoney
  const scale = amount < 1000 ? 1 : amount < 1_000_000 ? 1000 : 1_000_000
  const digits = scale === 1 ? 0 : scale === 1000 && amount >= 100_000 ? 0 : 1
  const number = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: digits }).format(amount / scale)
  return `${minor < 0 ? "−" : ""}${number}${scale === 1 ? "" : scale === 1000 ? labels.thousand : labels.million}`
}
