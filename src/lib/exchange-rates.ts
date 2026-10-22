import { currencyExponent } from "./currencies"
import { isIsoDate } from "./dates"

const SCALE = 10_000_000_000n

/** Positive fixed-point rate, with the same precision as NUMERIC(20,10). */
export function rateUnits(value: string): bigint {
  if (!/^\d{1,10}(\.\d{1,10})?$/.test(value)) throw new Error("Invalid exchange rate")
  const [whole = "0", fraction = ""] = value.split(".")
  const units = BigInt(whole) * SCALE + BigInt(fraction.padEnd(10, "0"))
  if (units <= 0n) throw new Error("Invalid exchange rate")
  return units
}

/** Round half-up (ties away from zero), without floating-point money arithmetic. */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Invalid denominator")
  const sign = numerator < 0n ? -1n : 1n
  const abs = numerator * sign
  return sign * ((abs + denominator / 2n) / denominator)
}

export function convertMinor(amount: number, from: string, to: string, fromRate: string, toRate: string): number {
  if (!Number.isSafeInteger(amount)) throw new Error("Unsafe money amount")
  if (from === to) return amount
  const numerator = BigInt(amount) * rateUnits(fromRate) * 10n ** BigInt(currencyExponent(to))
  const denominator = rateUnits(toRate) * 10n ** BigInt(currencyExponent(from))
  const result = Number(divideRounded(numerator, denominator))
  if (!Number.isSafeInteger(result)) throw new Error("Converted amount exceeds safe integer range")
  return result
}

export interface ExchangeRate {
  currency: string
  date: string
  rateToRub: string
  source: "cbr" | "manual"
}

/** Latest known <= date; manual overrides CBR only on the same date. */
export function selectRate(rates: readonly ExchangeRate[], currency: string, date: string): ExchangeRate | null {
  if (currency === "RUB") return { currency, date, rateToRub: "1", source: "cbr" }
  let best: ExchangeRate | null = null
  for (const r of rates) {
    if (r.currency !== currency || r.date > date) continue
    if (!best || r.date > best.date || (r.date === best.date && r.source === "manual")) best = r
  }
  return best
}

/** CBR can emit scientific notation (e.g. IRR = 4,47935E-05). Normalize exactly to the DB scale. */
function cbrRate(value: string): string {
  const match = /^(\d{1,20})(?:\.(\d{1,20}))?(?:[eE]([+-]?\d{1,2}))?$/.exec(value.replace(",", "."))
  if (!match) throw new Error("Invalid CBR rate")
  const fraction = match[2] ?? ""
  const shift = 10 + Number(match[3] ?? 0) - fraction.length
  const digits = BigInt(match[1]! + fraction)
  const units = shift >= 0 ? digits * 10n ** BigInt(shift) : divideRounded(digits, 10n ** BigInt(-shift))
  const result = `${units / SCALE}.${String(units % SCALE).padStart(10, "0")}`
  rateUnits(result)
  return result
}

/** XML_daily.asp is Windows-1251; numeric fields use decimal commas. No XML entities are evaluated. */
export function parseCbrXml(input: string | Uint8Array): ExchangeRate[] {
  const xml = typeof input === "string" ? input : new TextDecoder("windows-1251").decode(input)
  const dateMatch = /<ValCurs\b[^>]*\bDate=["'](\d{2})\.(\d{2})\.(\d{4})["']/.exec(xml)
  if (!dateMatch || !/<\/ValCurs>/.test(xml)) throw new Error("Invalid CBR XML")
  const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
  if (!isIsoDate(date)) throw new Error("Invalid CBR date")
  const rates: ExchangeRate[] = []
  for (const match of xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g)) {
    const body = match[1]!
    const field = (name: string) => new RegExp(`<${name}>\\s*([^<]+)\\s*</${name}>`).exec(body)?.[1]?.trim()
    const currency = field("CharCode")
    if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new Error("Invalid CBR currency")
    const unit = field("VunitRate")
    let rateToRub: string
    if (unit) {
      rateToRub = cbrRate(unit)
    } else {
      const nominal = field("Nominal")
      if (!nominal || !/^\d+$/.test(nominal) || BigInt(nominal) <= 0n) throw new Error("Invalid CBR nominal")
      const units = divideRounded(rateUnits(cbrRate(field("Value") ?? "")), BigInt(nominal))
      rateToRub = `${units / SCALE}.${String(units % SCALE).padStart(10, "0")}`
      rateUnits(rateToRub)
    }
    rates.push({ currency, date, rateToRub, source: "cbr" })
  }
  if (!rates.length) throw new Error("Empty CBR XML")
  return rates
}
