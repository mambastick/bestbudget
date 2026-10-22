import { currencyExponent, type Currency } from "./currencies"
import { isIsoDate } from "./dates"

/** Currency-edition IDs from XML_daily.asp (verified against the tracked CBR fixture). */
export const CBR_CURRENCY_IDS: Record<Exclude<Currency, "RUB">, string> = {
  USD: "R01235", EUR: "R01239", CNY: "R01375", KZT: "R01335", BYN: "R01090B", AMD: "R01060",
  GEL: "R01210", TRY: "R01700J", AED: "R01230", UZS: "R01717", KGS: "R01370", GBP: "R01035",
  CHF: "R01775", JPY: "R01820", THB: "R01675", KRW: "R01815", INR: "R01270", BRL: "R01115",
  CAD: "R01350", AUD: "R01010", BHD: "R01080",
}

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

function xmlText(input: string | Uint8Array): string {
  return typeof input === "string" ? input : new TextDecoder("windows-1251").decode(input)
}

function xmlAttribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=["']([^"']+)["']`).exec(attributes)?.[1]
}

function cbrDate(value: string | undefined): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value ?? "")
  const date = match ? `${match[3]}-${match[2]}-${match[1]}` : ""
  if (!isIsoDate(date)) throw new Error("Invalid CBR date")
  return date
}

function xmlRate(body: string): string {
  const field = (name: string) => new RegExp(`<${name}>\\s*([^<]+)\\s*</${name}>`).exec(body)?.[1]?.trim()
  const unit = field("VunitRate")
  if (unit) return cbrRate(unit)
  const nominal = field("Nominal")
  if (!nominal || !/^\d+$/.test(nominal) || BigInt(nominal) <= 0n) throw new Error("Invalid CBR nominal")
  const units = divideRounded(rateUnits(cbrRate(field("Value") ?? "")), BigInt(nominal))
  const result = `${units / SCALE}.${String(units % SCALE).padStart(10, "0")}`
  rateUnits(result)
  return result
}

/** XML_daily.asp is Windows-1251; the returned publication date may differ from the requested date. */
export function parseCbrXml(input: string | Uint8Array): ExchangeRate[] {
  const xml = xmlText(input)
  const root = /<ValCurs\b([^>]*)>/.exec(xml)
  if (!root || !/<\/ValCurs>/.test(xml)) throw new Error("Invalid CBR XML")
  const date = cbrDate(xmlAttribute(root[1]!, "Date"))
  const rates: ExchangeRate[] = []
  for (const match of xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g)) {
    const body = match[1]!
    const currency = /<CharCode>\s*([A-Z]{3})\s*<\/CharCode>/.exec(body)?.[1]
    if (!currency) throw new Error("Invalid CBR currency")
    rates.push({ currency, date, rateToRub: xmlRate(body), source: "cbr" })
  }
  if (!rates.length) throw new Error("Empty CBR XML")
  return rates
}

/** Validates the echoed range/ID before treating an empty XML_dynamic response as confirmed absence. */
export function parseCbrHistoryXml(input: string | Uint8Array, currency: Exclude<Currency, "RUB">, from: string, to: string): ExchangeRate[] {
  const xml = xmlText(input)
  const root = /<ValCurs\b([^>]*?)(?:\/>|>([\s\S]*)<\/ValCurs>)/.exec(xml)
  if (!root || xmlAttribute(root[1]!, "ID") !== CBR_CURRENCY_IDS[currency] ||
      cbrDate(xmlAttribute(root[1]!, "DateRange1")) !== from || cbrDate(xmlAttribute(root[1]!, "DateRange2")) !== to) {
    throw new Error("Invalid CBR history range")
  }
  const body = root[2] ?? ""
  if (body.replace(/<Record\b[^>]*>[\s\S]*?<\/Record>/g, "").trim()) throw new Error("Malformed CBR history")
  const rates: ExchangeRate[] = []
  for (const match of body.matchAll(/<Record\b([^>]*)>([\s\S]*?)<\/Record>/g)) {
    const date = cbrDate(xmlAttribute(match[1]!, "Date"))
    if (date < from || date > to || xmlAttribute(match[1]!, "Id") !== CBR_CURRENCY_IDS[currency]) throw new Error("Invalid CBR history record")
    rates.push({ currency, date, rateToRub: xmlRate(match[2]!), source: "cbr" })
  }
  return rates
}
