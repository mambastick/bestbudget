import { and, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { closeDb, getDb } from "@/db"
import { exchangeRateFetches, exchangeRates } from "@/db/schema"
import { CBR_CURRENCY_IDS, selectRate } from "@/lib/exchange-rates"
import { addDays, weekday } from "@/lib/dates"
import { loadRates } from "@/server/services/exchange-rates"

vi.mock("@/lib/env", async (original) => {
  const real = await original<typeof import("@/lib/env")>()
  return { ...real, env: () => ({ ...real.env(), FX_PROVIDER: "cbr" as const }) }
})
const fetchMock = vi.fn().mockRejectedValue(new Error("Unexpected network request"))
const dotted = (date: string) => date.split("-").reverse().join(".")
const iso = (date: string) => date.split("/").reverse().join("-")
const daily = (date: string) => new Response(`<ValCurs Date="${dotted(date)}"><Valute ID="R01235"><CharCode>USD</CharCode><Nominal>1</Nominal><Value>95,1234</Value></Valute></ValCurs>`)
const record = (date: string, id = "R01235") => `<Record Date="${dotted(date)}" Id="${id}"><Nominal>1</Nominal><Value>95,1234</Value></Record>`
function history(url: string, records: string[] = []) {
  const params = new URL(url).searchParams
  const from = iso(params.get("date_req1")!)
  const to = iso(params.get("date_req2")!)
  return new Response(`<ValCurs ID="${params.get("VAL_NM_RQ")}" DateRange1="${dotted(from)}" DateRange2="${dotted(to)}">${records.join("")}</ValCurs>`)
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-02-01T09:00:00Z") })
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset().mockRejectedValue(new Error("Unexpected network request"))
  await getDb().delete(exchangeRateFetches)
  await getDb().delete(exchangeRates)
})
afterAll(async () => {
  await getDb().delete(exchangeRateFetches)
  await getDb().delete(exchangeRates)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await closeDb()
})

describe("persistent CBR publication cache", () => {
  it("uses Friday's publication for a weekend without exact-date requests", async () => {
    await getDb().insert(exchangeRates).values({ currency: "USD", date: "2026-10-30", source: "cbr", rateToRub: "95" })
    const needs = ["2026-10-31", "2026-11-01"].map((date) => ({ currency: "USD", date }))
    vi.setSystemTime(new Date("2026-11-01T09:00:00Z"))
    expect(selectRate(await loadRates(needs), "USD", "2026-11-01")?.date).toBe("2026-10-30")
    vi.setSystemTime(new Date("2026-11-01T09:02:00Z"))
    await loadRates(needs)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("covers all New Year holidays with the last December publication", async () => {
    await getDb().insert(exchangeRates).values({ currency: "USD", date: "2025-12-31", source: "cbr", rateToRub: "95" })
    const needs = Array.from({ length: 11 }, (_, i) => ({ currency: "USD", date: addDays("2026-01-01", i) }))
    await loadRates(needs)
    await loadRates(needs)
    expect(fetchMock).not.toHaveBeenCalled()
    // The lookback includes its lower boundary.
    await loadRates([{ currency: "USD", date: "2026-01-14" }])
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("stores a daily response under its earlier publication date and does not repeat it", async () => {
    vi.setSystemTime(new Date("2026-11-01T09:00:00Z"))
    fetchMock.mockResolvedValueOnce(daily("2026-10-30"))
    const needs = [{ currency: "USD", date: "2026-11-01" }]
    expect(selectRate(await loadRates(needs), "USD", needs[0]!.date)?.date).toBe("2026-10-30")
    vi.setSystemTime(new Date("2026-11-01T09:02:00Z"))
    await loadRates(needs)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await getDb().select().from(exchangeRates).where(eq(exchangeRates.date, "2026-11-01"))).toHaveLength(0)
  })
  it("retains a future publication but selects an earlier dynamic rate for the requested day", async () => {
    vi.setSystemTime(new Date("2026-11-01T11:00:00Z"))
    fetchMock.mockImplementation(async (url: string) => url.includes("XML_daily") ? daily("2026-11-02") : history(url, [record("2026-10-30")]))
    const needs = [{ currency: "USD", date: "2026-11-01" }]
    const rates = await loadRates(needs)
    expect(selectRate(rates, "USD", needs[0]!.date)?.date).toBe("2026-10-30")
    expect(await getDb().select().from(exchangeRates).where(eq(exchangeRates.date, "2026-11-02"))).toHaveLength(1)
    vi.setSystemTime(new Date("2026-11-01T11:02:00Z"))
    await loadRates(needs)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it("does not re-fetch a confirmed current-day gap when the daily response is future-dated", async () => {
    vi.setSystemTime(new Date("2026-11-03T09:00:00Z"))
    fetchMock.mockImplementation(async (url: string) => url.includes("XML_daily") ? daily("2026-11-04") : history(url))
    const needs = [{ currency: "USD", date: "2026-11-03" }]
    expect(await loadRates(needs)).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.setSystemTime(new Date("2026-11-03T12:00:00Z"))
    await loadRates(needs)
    vi.setSystemTime(new Date("2026-11-05T09:00:00Z"))
    await loadRates(needs)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it("persists confirmed empty historical intervals across rerenders and a new DB connection", async () => {
    fetchMock.mockImplementation(async (url: string) => history(url))
    const needs = Array.from({ length: 11 }, (_, i) => ({ currency: "USD", date: addDays("2026-01-01", i) }))
    expect(await loadRates(needs)).toEqual([])
    const [coverage] = await getDb().select().from(exchangeRateFetches)
    expect(coverage).toMatchObject({ currency: "USD", fromDate: "2025-12-18", toDate: "2026-01-11", expiresAt: null })
    await closeDb()
    vi.setSystemTime(new Date("2026-03-01T09:00:00Z"))
    await loadRates(needs)
    await loadRates(needs)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("backfills two years with one dynamic request per currency, never one request per date", async () => {
    const needs = []
    for (let date = "2024-01-01"; date <= "2025-12-31"; date = addDays(date, 1)) {
      needs.push({ currency: "USD", date }, { currency: "EUR", date })
    }
    fetchMock.mockImplementation(async (url: string) => {
      const params = new URL(url).searchParams
      const records = []
      for (let date = iso(params.get("date_req1")!); date <= iso(params.get("date_req2")!); date = addDays(date, 1)) {
        if (weekday(date) <= 5) records.push(record(date, params.get("VAL_NM_RQ")!))
      }
      return history(url, records)
    })
    const rates = await loadRates(needs)
    expect(rates.length).toBeGreaterThan(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const currency of ["USD", "EUR"] as const) {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`XML_dynamic.asp?date_req1=18/12/2023&date_req2=31/12/2025&VAL_NM_RQ=${CBR_CURRENCY_IDS[currency]}`), expect.anything())
    }
    vi.setSystemTime(new Date("2026-03-01T09:00:00Z"))
    await loadRates(needs)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it("deduplicates concurrent history fetches and does not negative-cache invalid XML", async () => {
    const needs = [{ currency: "GBP", date: "2026-01-05" }]
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>"))
    await loadRates(needs)
    expect(await getDb().select().from(exchangeRateFetches)).toHaveLength(0)
    vi.setSystemTime(new Date("2026-02-01T09:02:00Z"))
    fetchMock.mockReset().mockImplementation(async (url: string) => history(url))
    await Promise.all([loadRates(needs), loadRates(needs)])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await getDb().select().from(exchangeRateFetches).where(and(eq(exchangeRateFetches.currency, "GBP"), eq(exchangeRateFetches.toDate, "2026-01-05")))).toHaveLength(1)
  })
})
