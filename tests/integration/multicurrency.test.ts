import { readFileSync } from "node:fs"
import { and, eq, inArray } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { closeDb, getDb } from "@/db"
import { categoryBudgets, exchangeRates, financialAccounts, transactions } from "@/db/schema"
import { getBudgets } from "@/server/services/budgets"
import { createAccount, listAccounts, updateAccount } from "@/server/services/catalog"
import { createConverter, quoteConversion, refreshCbrRates, saveManualRate } from "@/server/services/exchange-rates"
import { resolveHouseholdCtx, updateHousehold } from "@/server/services/households"
import { loadFinance } from "@/server/services/finance-data"
import { createRules, materializeOccurrence, virtualOccurrences } from "@/server/services/recurring"
import { actualBalance, getAnalytics, getCalendarMonth, getDashboard } from "@/server/services/reports"
import { confirmTransaction, createTransaction, exportTransactions } from "@/server/services/transactions"
import { setupHousehold } from "./helpers"

const provider = vi.hoisted(() => ({ value: "none" as "none" | "cbr" }))
vi.mock("@/lib/env", async (original) => {
  const real = await original<typeof import("@/lib/env")>()
  return { ...real, env: () => ({ ...real.env(), FX_PROVIDER: provider.value }) }
})
const fetchMock = vi.fn().mockRejectedValue(new Error("Network forbidden in tests"))
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-01T09:00:00Z") })
  vi.stubGlobal("fetch", fetchMock)
  await getDb().insert(exchangeRates).values([
    { currency: "USD", date: "2026-10-01", rateToRub: "90", source: "cbr" },
    { currency: "USD", date: "2026-11-01", rateToRub: "100", source: "cbr" },
    { currency: "EUR", date: "2026-10-01", rateToRub: "120", source: "manual" },
  ])
})
afterAll(async () => {
  await getDb().delete(exchangeRates).where(inArray(exchangeRates.currency, ["USD", "EUR", "JPY", "UZS"]))
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await closeDb()
})

describe("multi-currency finance", () => {
  it("posts RUB → USD and preserves both native balances and export currencies", async () => {
    const { ctx, mainAccount } = await setupHousehold()
    const usd = await createAccount(ctx, { name: "USD", kind: "savings", currency: "USD", openingBalance: 0 })
    await createTransaction(ctx, { type: "transfer", amount: 10000_00, toAmount: 100_00, accountId: mainAccount, toAccountId: usd.id, date: "2026-11-01", status: "posted" })
    expect((await listAccounts(ctx)).find((a) => a.id === mainAccount)?.balance).toBe(-10000_00)
    expect((await listAccounts(ctx)).find((a) => a.id === usd.id)?.balance).toBe(100_00)
    expect(await actualBalance(ctx)).toBe(0)
    expect((await exportTransactions(ctx, {}))[0]).toMatchObject({ currency: "RUB", toCurrency: "USD", toAmount: 100_00 })
    await expect(createTransaction(ctx, { type: "transfer", amount: 100, accountId: mainAccount, toAccountId: usd.id, date: "2026-11-01", status: "posted" })).rejects.toThrow(/сумму зачисления/)
    await expect(updateAccount(ctx, usd.id, { name: "USD", kind: "savings", openingBalance: 0, currency: "EUR" })).rejects.toThrow(/валюту счёта/)
    await expect(getDb().update(financialAccounts).set({ currency: "EUR" }).where(eq(financialAccounts.id, usd.id))).rejects.toThrow()
    await expect(getDb().insert(transactions).values({ householdId: ctx.householdId, type: "transfer", amount: 100, accountId: mainAccount, toAccountId: usd.id, date: "2026-11-01", title: "bad", status: "posted" })).rejects.toThrow()
  })
  it("converts historical flows at their date and plans and account valuations at latest rates", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const usd = await createAccount(ctx, { name: "USD", kind: "cash", currency: "USD", openingBalance: 100_00 })
    await createTransaction(ctx, { type: "expense", amount: 10_00, accountId: usd.id, categoryId: cat("Продукты"), date: "2026-10-15", status: "posted" })
    await createTransaction(ctx, { type: "expense", amount: 10_00, accountId: usd.id, categoryId: cat("Продукты"), date: "2026-11-01", status: "planned" })
    await createTransaction(ctx, { type: "expense", amount: 200_00, accountId: mainAccount, categoryId: cat("Продукты"), date: "2026-10-15", status: "posted" })
    const dash = await getDashboard(ctx, "2026-10-01")
    expect(dash.monthExpense).toBe(1100_00)
    expect(dash.balance).toBe(8800_00)
    expect(dash.warnings.join(" ")).toMatch(/курс от 2026-10-01/)
    const november = await getDashboard(ctx, "2026-11-01")
    expect(november.plannedExpense).toBe(1000_00)
    expect(november.forecastEndOfMonth).toBe(7800_00)
    expect(november.forecast[0]?.balance).toBe(7800_00)
    expect((await getBudgets(ctx, "2026-10-01")).find((c) => c.id === cat("Продукты"))?.spent).toBe(1100_00)
    expect((await getAnalytics(ctx, "2026-10-01", "2026-10-31")).current.expense).toBe(1100_00)
    expect((await getCalendarMonth(ctx, "2026-11-01")).days.at(-1)?.balance).toBe(7800_00)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("carries both amounts through recurring, virtual and confirmed transfers", async () => {
    const { ctx, mainAccount } = await setupHousehold()
    const usd = await createAccount(ctx, { name: "USD", kind: "savings", currency: "USD", openingBalance: 0 })
    const [rule] = await createRules(ctx, { rule: { type: "transfer", amount: 10000_00, toAmount: 99_00, accountId: mainAccount, toAccountId: usd.id, frequency: "monthly", startDate: "2026-11-01" } })
    const virtual = await virtualOccurrences(ctx, "2027-06-01", "2027-06-30", "2026-11-01")
    expect(virtual[0]?.toAmount).toBe(99_00)
    const id = await materializeOccurrence(ctx, rule!.id, "2027-06-01")
    const [row] = await getDb().select().from(transactions).where(eq(transactions.id, id))
    expect(row?.toAmount).toBe(99_00)
    await confirmTransaction(ctx, id, { version: 1, amount: 10100_00, toAmount: 100_00, date: "2026-11-01" })
    expect((await listAccounts(ctx)).find((a) => a.id === usd.id)?.balance).toBe(100_00)
    // Effective rate differs from CBR: the balance records the actual exchange loss.
    expect(await actualBalance(ctx)).toBe(-100_00)
  })
  it("preserves multiple monthly accruals for same-currency transfers", async () => {
    const { ctx, mainAccount } = await setupHousehold()
    const savings = await createAccount(ctx, { name: "RUB savings", kind: "savings", openingBalance: 0 })
    const rules = await createRules(ctx, {
      rule: { type: "transfer", amount: 100_00, accountId: mainAccount, toAccountId: savings.id, frequency: "monthly", dayOfMonth: 5, startDate: "2026-11-01" },
      extra: [{ dayOfMonth: 20, amount: 200_00 }],
    })
    expect(rules.map((r) => [r.amount, r.toAmount])).toEqual([[100_00, null], [200_00, null]])
  })
  it("keeps household references isolated and permits currency edits only on empty accounts", async () => {
    const a = await setupHousehold()
    const b = await setupHousehold()
    const usd = await createAccount(a.ctx, { name: "USD", kind: "cash", currency: "USD", openingBalance: 0 })
    await updateAccount(a.ctx, usd.id, { name: "JPY", kind: "cash", currency: "JPY", openingBalance: 0, version: 1 })
    await expect(updateAccount(a.ctx, usd.id, { name: "stale", kind: "cash", currency: "JPY", openingBalance: 0, version: 1 })).rejects.toThrow(/изменены/)
    await expect(createTransaction(b.ctx, { type: "transfer", amount: 1, toAmount: 1, accountId: b.mainAccount, toAccountId: usd.id, date: "2026-11-01", status: "posted" })).rejects.toThrow(/найден/)
    expect((await listAccounts(b.ctx)).map((r) => r.id)).not.toContain(usd.id)
    await expect(updateAccount(b.ctx, usd.id, { name: "bad", kind: "cash", currency: "USD", openingBalance: 0 })).rejects.toThrow(/найден/)
  })
  it("changes base currency only for owner, keeps budget minor units, and supports cross-rates", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    await getDb().insert(categoryBudgets).values({ householdId: ctx.householdId, categoryId: cat("Продукты"), amount: 1000_00 })
    await createTransaction(ctx, { type: "expense", amount: 120_00, accountId: mainAccount, categoryId: cat("Продукты"), date: "2026-11-01", status: "posted" })
    await expect(updateHousehold({ ...ctx, role: "admin" }, { name: "x", currency: "EUR" })).rejects.toThrow()
    await updateHousehold(ctx, { name: "EUR base", currency: "EUR", version: 1 })
    const next = (await resolveHouseholdCtx(ctx.userId, ctx.householdId))!
    expect(next.currency).toBe("EUR")
    expect((await getBudgets(next, "2026-11-01")).find((r) => r.id === cat("Продукты"))).toMatchObject({ limit: 1000_00, spent: 1_00 })
    const quote = await quoteConversion(120_00, "EUR", "USD", "2026-11-01")
    expect(quote.amount).toBe(144_00)
  })
  it("warns about completely missing rates without crashing pages or mixing native units", async () => {
    const { ctx } = await setupHousehold()
    await createAccount(ctx, { name: "BHD", kind: "cash", currency: "BHD", openingBalance: 1000 })
    const dash = await getDashboard(ctx, "2026-11-01")
    expect(dash.balance).toBe(0)
    expect(dash.warnings.join(" ")).toMatch(/Итоги неполные.*BHD/)
    expect((await quoteConversion(1000, "BHD", "RUB", "2026-11-01")).amount).toBeNull()
    const fx = createConverter([], "RUB")
    expect(fx.convert(1234, "RUB", "2026-11-01")).toBe(1234)
  })
})

describe("offline cache and manual rates", () => {
  it("fetches Windows-1251 XML with mocked network, stores effective date and falls back offline", async () => {
    provider.value = "cbr"
    const bytes = readFileSync(new URL("../fixtures/cbr-daily.xml", import.meta.url))
    fetchMock.mockResolvedValueOnce(new Response(bytes))
    expect(await refreshCbrRates("2026-10-22", true)).toBe(true)
    const [rate] = await getDb().select().from(exchangeRates).where(and(eq(exchangeRates.currency, "JPY"), eq(exchangeRates.date, "2026-10-22")))
    expect(rate?.rateToRub).toBe("0.6012340000")
    fetchMock.mockRejectedValue(new Error("offline"))
    expect(await refreshCbrRates("2026-10-23", true)).toBe(false)
    const result = await quoteConversion(100, "JPY", "RUB", "2026-10-23")
    expect(result.amount).toBe(6012)
    expect(result.warnings.join(" ")).toMatch(/2026-10-22/)
    provider.value = "none"
  })
  it("lazily requests historical destination and opening-balance valuation dates", async () => {
    const { ctx, mainAccount } = await setupHousehold()
    const usd = await createAccount(ctx, { name: "USD", currency: "USD", kind: "savings", openingBalance: 100_00 })
    await createTransaction(ctx, { type: "transfer", amount: 100_00, toAmount: 1_00, accountId: mainAccount, toAccountId: usd.id, date: "2026-09-15", status: "posted" })
    const xml = readFileSync(new URL("../fixtures/cbr-daily.xml", import.meta.url), "utf8").replace("22.10.2026", "15.09.2026")
    fetchMock.mockClear().mockResolvedValueOnce(new Response(xml))
    provider.value = "cbr"
    try {
      const data = await loadFinance(ctx)
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("date_req=15/09/2026"), expect.anything())
      expect(data.convert(100_00, "USD", "2026-09-15")).toBe(951_234)
      fetchMock.mockResolvedValueOnce(new Response(xml.replace("15.09.2026", "14.09.2026")))
      const earlier = await loadFinance(ctx, ["2026-09-14"])
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("date_req=14/09/2026"), expect.anything())
      expect(earlier.convert(100_00, "USD", "2026-09-14")).toBe(951_234)
    } finally {
      provider.value = "none"
      fetchMock.mockRejectedValue(new Error("Network forbidden in tests"))
    }
  })
  it("manual overrides CBR on the same date and rejects invalid rates", async () => {
    const { ctx } = await setupHousehold()
    await saveManualRate(ctx.userId, { currency: "USD", date: "2026-11-01", rateToRub: "99,5" })
    expect((await quoteConversion(100_00, "USD", "RUB", "2026-11-01")).amount).toBe(9950_00)
    await expect(saveManualRate(ctx.userId, { currency: "USD", date: "2026-11-01", rateToRub: "0" })).rejects.toThrow()
  })
})
