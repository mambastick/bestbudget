import "server-only"
import { and, desc, inArray, lte, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { exchangeRates } from "@/db/schema"
import { CURRENCY_CODES } from "@/lib/currencies"
import { todayIn } from "@/lib/dates"
import { env } from "@/lib/env"
import { convertMinor, parseCbrXml, rateUnits, selectRate, type ExchangeRate } from "@/lib/exchange-rates"
import { audit } from "../audit"
import { AppError } from "../errors"
import { isoDate } from "./transactions"

const inFlight = new Map<string, Promise<boolean>>()
const attempted = new Map<string, number>()

/** Two short attempts, deduplicated across concurrent reports; failures have a one-minute backoff. */
export async function refreshCbrRates(date: string, force = false, deadline = Date.now() + 1300): Promise<boolean> {
  isoDate.parse(date)
  if (env().FX_PROVIDER === "none") return false
  const pending = inFlight.get(date)
  if (pending) return pending
  if (!force && Date.now() - (attempted.get(date) ?? 0) < 60_000) return false
  const request = (async () => {
    for (let attempt = 0; attempt < 2 && Date.now() < deadline; attempt++) {
      try {
        const [y, m, d] = date.split("-")
        const response = await fetch(`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${d}/${m}/${y}`, {
          signal: AbortSignal.timeout(Math.max(1, Math.min(650, deadline - Date.now()))), cache: "no-store",
        })
        if (!response.ok) throw new Error("CBR unavailable")
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length > 1_000_000) throw new Error("CBR response too large")
        const rates = parseCbrXml(bytes)
        if (rates.some((r) => r.date > date)) throw new Error("Future CBR rate")
        await getDb().insert(exchangeRates).values(rates).onConflictDoUpdate({
          target: [exchangeRates.currency, exchangeRates.date, exchangeRates.source],
          set: { rateToRub: sql`excluded.rate_to_rub` },
        })
        return true
      } catch {
        // Offline operation uses cached rates; provider errors never escape into page rendering.
      }
    }
    return false
  })()
  inFlight.set(date, request)
  try { return await request } finally {
    inFlight.delete(date)
    attempted.set(date, Date.now())
    if (attempted.size > 1000) attempted.delete(attempted.keys().next().value!)
  }
}

export interface RateNeed { currency: string; date: string }

/** One batched DB read, bounded parallel lazy fetches, then one reread. Never one query per operation. */
export async function loadRates(needs: RateNeed[]) {
  const currencies = [...new Set(needs.map((n) => n.currency).filter((c) => c !== "RUB"))]
  if (!currencies.length) return [] as ExchangeRate[]
  const maxDate = needs.reduce((max, n) => n.date > max ? n.date : max, "0000-01-01")
  const read = () => getDb().select().from(exchangeRates).where(and(inArray(exchangeRates.currency, currencies), lte(exchangeRates.date, maxDate)))
  let rates = await read()
  if (env().FX_PROVIDER === "cbr") {
    const cachedDates = new Set(rates.map((r) => `${r.currency}:${r.date}`))
    const missingDates = [...new Set(needs.filter((n) => n.currency !== "RUB" && !cachedDates.has(`${n.currency}:${n.date}`)).map((n) => n.date))].sort().reverse()
    // A render has one 1.3s network window, regardless of the number of historical dates.
    const deadline = Date.now() + 1300
    let changed = false
    await Promise.all(Array.from({ length: Math.min(4, missingDates.length) }, async () => {
      while (missingDates.length && Date.now() < deadline) {
        const date = missingDates.shift()!
        changed = (await refreshCbrRates(date, false, deadline)) || changed
      }
    }))
    if (changed) rates = await read()
  }
  return rates
}

export function createConverter(rates: ExchangeRate[], base: string) {
  const warnings = new Set<string>()
  const indexed = new Map<string, ExchangeRate[]>()
  for (const r of rates) {
    const bucket = indexed.get(r.currency) ?? []
    bucket.push(r)
    indexed.set(r.currency, bucket)
  }
  for (const bucket of indexed.values()) bucket.sort((a, b) => a.date.localeCompare(b.date) || (a.source === b.source ? 0 : a.source === "manual" ? 1 : -1))
  const selected = new Map<string, ExchangeRate | null>()
  const rate = (currency: string, date: string) => {
    const key = `${currency}:${date}`
    if (!selected.has(key)) {
      if (currency === "RUB") selected.set(key, { currency, date, rateToRub: "1", source: "cbr" })
      else {
        const bucket = indexed.get(currency) ?? []
        let lo = 0
        let hi = bucket.length
        while (lo < hi) {
          const mid = (lo + hi) >>> 1
          if (bucket[mid]!.date <= date) lo = mid + 1
          else hi = mid
        }
        selected.set(key, bucket[lo - 1] ?? null)
      }
    }
    return selected.get(key)!
  }
  function convert(amount: number, currency: string, date: string): number {
    if (!amount || currency === base) return amount
    const from = rate(currency, date)
    const to = rate(base, date)
    if (!from || !to) {
      warnings.add(`Итоги неполные: нет курса ${!from ? currency : base} на ${date}. Введите ручной курс в администрировании.`)
      return 0
    }
    for (const r of [from, to]) {
      if (r.currency !== "RUB" && r.date < date) warnings.add(`${r.currency}: курс от ${r.date} (${r.source === "manual" ? "ручной" : "ЦБ"}).`)
    }
    return convertMinor(amount, currency, base, from.rateToRub, to.rateToRub)
  }
  return { convert, warnings }
}

/** Rates are global public data, so only a system administrator may change them. */
export const manualRateInput = z.object({
  currency: z.enum(CURRENCY_CODES).refine((c) => c !== "RUB", "Курс RUB всегда равен 1"),
  date: isoDate,
  rateToRub: z.string().trim().transform((v) => v.replace(",", ".")).refine((v) => {
    try { rateUnits(v); return true } catch { return false }
  }, "Укажите положительный курс: до 10 знаков до и после запятой"),
})

export async function saveManualRate(actorId: string, raw: z.input<typeof manualRateInput>) {
  const input = manualRateInput.parse(raw)
  if (input.date > todayIn("Europe/Moscow")) throw new AppError("Курс не может быть из будущего")
  await getDb().insert(exchangeRates).values({ ...input, source: "manual" }).onConflictDoUpdate({
    target: [exchangeRates.currency, exchangeRates.date, exchangeRates.source], set: { rateToRub: input.rateToRub },
  })
  await audit({ action: "exchange_rate.manual", entityType: "exchange_rate", actorId, meta: input })
}

export async function listExchangeRates() {
  return getDb().select().from(exchangeRates).orderBy(desc(exchangeRates.date), exchangeRates.currency, desc(exchangeRates.source)).limit(100)
}

export async function quoteConversion(amount: number, from: string, to: string, date: string, today = todayIn("Europe/Moscow")) {
  z.number().int().nonnegative().safe().parse(amount)
  z.enum(CURRENCY_CODES).parse(from)
  z.enum(CURRENCY_CODES).parse(to)
  isoDate.parse(date)
  const at = date > today ? today : date
  const rates = await loadRates([{ currency: from, date: at }, { currency: to, date: at }])
  if (from !== to && (!selectRate(rates, from, at) || !selectRate(rates, to, at))) return { amount: null, warnings: ["Нет курса. Укажите сумму зачисления вручную; для отчётов добавьте курс в администрировании."] }
  const fx = createConverter(rates, to)
  return { amount: fx.convert(amount, from, at), warnings: [...fx.warnings] }
}
