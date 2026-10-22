import "server-only"
import { and, desc, gte, inArray, isNull, lte, or, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { exchangeRateFetches, exchangeRates } from "@/db/schema"
import { CURRENCY_CODES, type Currency } from "@/lib/currencies"
import { addDays, todayIn } from "@/lib/dates"
import { env } from "@/lib/env"
import { CBR_CURRENCY_IDS, convertMinor, parseCbrHistoryXml, parseCbrXml, rateUnits, selectRate, type ExchangeRate } from "@/lib/exchange-rates"
import { audit } from "../audit"
import { AppError } from "../errors"
import { isoDate } from "./transactions"

const inFlight = new Map<string, Promise<boolean>>()
const attempted = new Map<string, number>()
const REQUEST_WINDOW_MS = 1300
const RECENT_DAYS = 14

type Coverage = Pick<typeof exchangeRateFetches.$inferSelect, "currency" | "fromDate" | "toDate">

function cbrDate(date: string) {
  const [y, m, d] = date.split("-")
  return `${d}/${m}/${y}`
}

/** Confirmed past/current publication gaps are permanent; only not-yet-arrived dates expire. */
function coverageRows(currencies: string[], from: string, to: string) {
  const today = todayIn("Europe/Moscow")
  const tomorrow = addDays(today, 1)
  return currencies.flatMap((currency) => [
    ...(from <= today ? [{ currency, fromDate: from, toDate: to <= today ? to : today, expiresAt: null }] : []),
    ...(to > today ? [{ currency, fromDate: from > today ? from : tomorrow, toDate: to, expiresAt: new Date(Date.now() + 3_600_000) }] : []),
  ])
}

/** Rate rows and successful-query coverage commit together, including a valid empty response. */
async function storeResponse(rates: ExchangeRate[], currencies: string[], from: string, to: string) {
  const coverage = coverageRows(currencies, from, to)
  await getDb().transaction(async (tx) => {
    if (rates.length) await tx.insert(exchangeRates).values(rates).onConflictDoUpdate({
      target: [exchangeRates.currency, exchangeRates.date, exchangeRates.source], set: { rateToRub: sql`excluded.rate_to_rub` },
    })
    await tx.insert(exchangeRateFetches).values(coverage).onConflictDoUpdate({
      target: [exchangeRateFetches.currency, exchangeRateFetches.fromDate, exchangeRateFetches.toDate],
      set: { checkedAt: new Date(), expiresAt: sql`excluded.expires_at` },
    })
  })
}

/** Network failures have a short in-process backoff; successful/negative coverage lives in PostgreSQL. */
async function requestCbr(key: string, url: string, consume: (bytes: Uint8Array) => Promise<void>, force: boolean, deadline: number) {
  if (env().FX_PROVIDER === "none") return false
  const pending = inFlight.get(key)
  if (pending) return pending
  if (!force && Date.now() - (attempted.get(key) ?? 0) < 60_000) return false
  const request = (async () => {
    for (let attempt = 0; attempt < 2 && Date.now() < deadline; attempt++) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(Math.max(1, Math.min(650, deadline - Date.now()))), cache: "no-store",
        })
        if (!response.ok) throw new Error("CBR unavailable")
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length > 1_000_000) throw new Error("CBR response too large")
        await consume(bytes)
        return true
      } catch {
        // Offline operation uses cached rates; errors and malformed XML never create negative coverage.
      }
    }
    return false
  })()
  inFlight.set(key, request)
  try { return await request } finally {
    inFlight.delete(key)
    attempted.set(key, Date.now())
    if (attempted.size > 1000) attempted.delete(attempted.keys().next().value!)
  }
}

/** Fresh-day snapshot. Store its actual publication date even when it differs from the requested day. */
export async function refreshCbrRates(date: string, force = false, deadline = Date.now() + REQUEST_WINDOW_MS) {
  isoDate.parse(date)
  return requestCbr(`daily:${date}`, `https://www.cbr.ru/scripts/XML_daily.asp?date_req=${cbrDate(date)}`, async (bytes) => {
    const rates = parseCbrXml(bytes)
    await storeResponse(rates, [...new Set([...CURRENCY_CODES.filter((c) => c !== "RUB"), ...rates.map((r) => r.currency)])], date, date)
  }, force, deadline)
}

/** One request per currency/range, with a leading lookback supplied by the caller. */
export async function refreshCbrHistory(currency: Exclude<Currency, "RUB">, from: string, to: string, force = false, deadline = Date.now() + REQUEST_WINDOW_MS) {
  z.enum(CURRENCY_CODES).parse(currency)
  isoDate.parse(from)
  isoDate.parse(to)
  if (from > to || !CBR_CURRENCY_IDS[currency]) throw new AppError("Некорректный диапазон курсов")
  const url = `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${cbrDate(from)}&date_req2=${cbrDate(to)}&VAL_NM_RQ=${CBR_CURRENCY_IDS[currency]}`
  return requestCbr(`history:${currency}:${from}:${to}`, url, async (bytes) => {
    await storeResponse(parseCbrHistoryXml(bytes, currency, from, to), [currency], from, to)
  }, force, deadline)
}

export interface RateNeed { currency: string; date: string }

/** Adjacent permanent/expiring coverage segments can jointly satisfy a requested interval. */
function covered(coverage: Coverage[], currency: string, from: string, to: string) {
  let next = from
  for (const range of coverage) {
    if (range.currency !== currency || range.toDate < next) continue
    if (range.fromDate > next) return false
    if (range.toDate >= to) return true
    next = addDays(range.toDate, 1)
  }
  return false
}

/** Constant DB reads; recent known rates or confirmed publication gaps prevent repeated provider requests. */
export async function loadRates(rawNeeds: RateNeed[]) {
  const needs = [...new Map(rawNeeds.filter((n) => n.currency !== "RUB").map((n) => [`${n.currency}:${n.date}`, n])).values()]
  if (!needs.length) return [] as ExchangeRate[]
  const currencies = [...new Set(needs.map((n) => n.currency))]
  const dates = needs.map((n) => n.date).sort()
  const minDate = addDays(dates[0]!, -RECENT_DAYS)
  const maxDate = dates.at(-1)!
  const read = () => getDb().select().from(exchangeRates).where(and(inArray(exchangeRates.currency, currencies), lte(exchangeRates.date, maxDate)))
  if (env().FX_PROVIDER === "none") return read()
  const readCoverage = () => getDb().select().from(exchangeRateFetches).where(and(
    inArray(exchangeRateFetches.currency, currencies), lte(exchangeRateFetches.fromDate, maxDate), gte(exchangeRateFetches.toDate, minDate),
    or(isNull(exchangeRateFetches.expiresAt), gte(exchangeRateFetches.expiresAt, new Date())),
  )).orderBy(exchangeRateFetches.fromDate)
  let [rates, coverage] = await Promise.all([read(), readCoverage()])
  const missing = () => needs.filter((n) => {
    const rate = selectRate(rates, n.currency, n.date)
    const from = addDays(n.date, -RECENT_DAYS)
    return (!rate || rate.date < from) && !covered(coverage, n.currency, from, n.date)
  })
  const today = todayIn("Europe/Moscow")
  const deadline = Date.now() + REQUEST_WINDOW_MS
  const fresh = missing().filter((n) => n.date >= today && !covered(coverage, n.currency, n.date, n.date)).map((n) => n.date).sort().at(-1)
  if (fresh && await refreshCbrRates(fresh, false, deadline)) [rates, coverage] = await Promise.all([read(), readCoverage()])

  const ranges = new Map<string, { from: string; to: string }>()
  for (const need of missing()) {
    const from = addDays(need.date, -RECENT_DAYS)
    const range = ranges.get(need.currency)
    ranges.set(need.currency, { from: range && range.from < from ? range.from : from, to: range && range.to > need.date ? range.to : need.date })
  }
  // History is batched over the complete required range per currency, never per operation/day.
  const queue = [...ranges.entries()]
  let changed = false
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length && Date.now() < deadline) {
      const [currency, range] = queue.shift()!
      changed = (await refreshCbrHistory(currency as Exclude<Currency, "RUB">, range.from, range.to, false, deadline)) || changed
    }
  }))
  return changed ? read() : rates
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
      for (const missing of [!from ? currency : null, !to ? base : null]) {
        if (missing) warnings.add(`Нет курса ${missing}.`)
      }
      return 0
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
  const selectedRates = [...new Set([from, to])].flatMap((c) => selectRate(rates, c, at) ?? [])
  if (from !== to && (!selectRate(rates, from, at) || !selectRate(rates, to, at))) return { amount: null, rates: selectedRates, warnings: ["Нет курса. Укажите сумму зачисления вручную; для отчётов добавьте курс в администрировании."] }
  const fx = createConverter(rates, to)
  return { amount: fx.convert(amount, from, at), rates: selectedRates, warnings: [...fx.warnings] }
}
