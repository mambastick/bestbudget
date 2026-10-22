import { currencyExponent } from "./currencies"

/**
 * Money is stored as integer minor units (kopecks for RUB) in BIGINT columns
 * and handled as JS numbers, which are exact up to 2^53 (≈ 90 trillion rubles).
 */

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, fractionDigits: number) {
  const key = `${currency}:${fractionDigits}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat("ru-RU", {
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
export function formatMoney(minor: number, currency = "RUB", opts: { sign?: boolean } = {}): string {
  const exponent = currencyExponent(currency)
  const scale = 10 ** exponent
  const digits = minor % scale === 0 ? 0 : exponent
  const text = formatter(currency, digits).format(Math.abs(minor) / scale)
  if (minor < 0) return `−${text}`
  if (opts.sign && minor > 0) return `+${text}`
  return text
}

/** Compact form for chart axes: 150 000 → "150 тыс." */
export function formatMoneyCompact(minor: number, currency = "RUB"): string {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(minor / 10 ** currencyExponent(currency))
}

/** Formats minor units for an editable input: 1234550 → "12345,50" (grouping is added by the input). */
export function minorToInput(minor: number, currency = "RUB"): string {
  const abs = Math.abs(minor)
  const exponent = currencyExponent(currency)
  const scale = 10 ** exponent
  const rub = Math.floor(abs / scale)
  const kop = abs % scale
  return `${minor < 0 ? "-" : ""}${rub}${kop ? "," + String(kop).padStart(exponent, "0") : ""}`
}

/**
 * Parses user input like "1 234,5", "1234.50" or "150000" into minor units.
 * Returns null for anything that is not a valid non-negative amount with at most the currency exponent decimals.
 */
export function parseMoney(input: string, currency = "RUB"): number | null {
  const normalized = input.replace(/[\s\u00a0\u2009\u202f₽]/g, "").replace(",", ".")
  const exponent = currencyExponent(currency)
  if (!new RegExp(`^\\d+${exponent ? `(\\.\\d{0,${exponent}})?` : ""}$`).test(normalized)) return null
  const [whole = "0", frac = ""] = normalized.split(".")
  const minor = Number(whole) * 10 ** exponent + Number(frac.padEnd(exponent, "0"))
  return Number.isSafeInteger(minor) ? minor : null
}

/** Very short label for dense layouts (calendar cells): 950 → "950", 12 500 → "12,5к", 238 000 → "238к", 1 200 000 → "1,2М". */
export function formatMoneyShort(minor: number, currency = "RUB"): string {
  const rub = Math.round(Math.abs(minor) / 10 ** currencyExponent(currency))
  const sign = minor < 0 ? "−" : ""
  const fmt = (n: number, digits: number) => n.toFixed(digits).replace(/\.0$/, "").replace(".", ",")
  if (rub < 1000) return `${sign}${rub}`
  if (rub < 1_000_000) return `${sign}${fmt(rub / 1000, rub < 100_000 ? 1 : 0)}к`
  return `${sign}${fmt(rub / 1_000_000, 1)}М`
}
