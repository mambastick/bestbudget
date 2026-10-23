import { describe, expect, it } from "vitest"
import { isQuiet, noticesFor, parsePaymentCallback, parseTelegramUpdate, preferencesInput, scheduledNotices, truncateMessage, type NoticeSnapshot } from "./notifications"

const id = "987a5387-e12e-4e12-b689-74d163bfbe84"
const snapshot: NoticeSnapshot = {
  householdId: "family", currency: "RUB",
  payments: [{ id, version: 2, date: "2026-10-24", type: "expense", status: "planned", title: "Ипотека", amount: 4500000, currency: "RUB", accountName: "Сбер" }],
  forecast: [{ date: "2026-10-28", balance: -1230000 }],
  budgets: [{ id: "food", name: "Продукты", limit: 100000, spent: 115000 }],
}
const p = preferencesInput.parse({})
describe("notification selection", () => {
  it("formats tomorrow's payment, forecast and budget, with stable event keys", () => {
    const items = noticesFor(snapshot, p, "2026-10-23", "ru")
    expect(items.map((n) => n.kind)).toEqual(["due", "cash_gap", "budget"])
    expect(items[0]!.text.replace(/\u00a0/g, " ")).toBe("Завтра платёж: Ипотека — 45 000 ₽ со счёта Сбер")
    expect(items[0]!.payment).toEqual({ id, version: 2 })
    expect(items[1]!.text).toContain("−12")
    expect(items[2]!.text).toContain("15%")
    expect(items[0]!.key).toBe(`due:${id}:2026-10-24`)
    expect(noticesFor(snapshot, p, "2026-10-24", "ru")[0]!.key).toBe(items[0]!.key)
    expect(noticesFor(snapshot, p, "2026-11-01", "ru").at(-1)!.key).not.toBe(items.at(-1)!.key)
  })
  it("selects overdue, lead time, event switches and exact budget threshold", () => {
    expect(noticesFor(snapshot, p, "2026-10-26", "ru")[0]!.text).toContain("не подтверждена 2 дня.")
    expect(noticesFor(snapshot, { ...p, daysBefore: 0, cashGap: false, budget: false }, "2026-10-23", "ru")).toEqual([])
    expect(noticesFor(snapshot, { ...p, due: false, overdue: false, cashGap: false, budget: false }, "2026-10-26", "ru")).toEqual([])
    expect(noticesFor(snapshot, { ...p, budgetThreshold: 16 }, "2026-10-23", "ru").some((n) => n.kind === "budget")).toBe(false)
    const exact = { ...snapshot, budgets: [{ id: "food", name: "Продукты", limit: 100001, spent: 115001 }] }
    expect(noticesFor(exact, p, "2026-10-23", "ru").some((n) => n.kind === "budget")).toBe(false)
    expect(noticesFor({ ...snapshot, payments: snapshot.payments.map((t) => ({ ...t, status: "posted" })) }, p, "2026-10-23", "ru").some((n) => n.kind === "due")).toBe(false)
  })
  it("keeps payment minor units in the account currency and forecasts in the base currency", () => {
    const foreign = {
      ...snapshot,
      currency: "EUR",
      payments: snapshot.payments.map((payment) => ({ ...payment, amount: 10000, currency: "USD" })),
    }
    const notices = noticesFor(foreign, p, "2026-10-23", "ru")
    expect(notices[0]!.text.replace(/\u00a0/g, " ")).toContain("100 $")
    expect(notices[1]!.text.replace(/\u00a0/g, " ")).toContain("−12 300 €")
    expect(noticesFor(foreign, p, "2026-10-26", "ru")[0]!.text.replace(/\u00a0/g, " ")).toContain("100 $")
    const yen = { ...foreign, payments: foreign.payments.map((payment) => ({ ...payment, amount: 100, currency: "JPY" })) }
    expect(noticesFor(yen, p, "2026-10-23", "ru")[0]!.text.replace(/\u00a0/g, " ")).toContain("100 ¥")
    const digest = scheduledNotices(foreign, { ...p, digest: true }, "Europe/Moscow", new Date("2026-10-23T09:00:00Z"), "ru")
    expect(digest[0]!.text.replace(/\u00a0/g, " ")).toContain("100 $")
    expect(digest[0]!.text.replace(/\u00a0/g, " ")).toContain("−12 300 €")
  })
  it("localizes every notice and truncation without translating user data or event keys", () => {
    const ru = noticesFor(snapshot, p, "2026-10-23", "ru")
    const en = noticesFor(snapshot, p, "2026-10-23", "en")
    expect(en.map((n) => n.key)).toEqual(ru.map((n) => n.key))
    expect(en[0]!.text).toContain("Tomorrow: Ипотека — RUB 45,000 from Сбер")
    expect(en[1]!.text).toContain("October 28")
    expect(en[2]!.text).toBe("The “Продукты” budget is 15% over its limit")
    for (const [count, ending] of [[1, "1 день"], [2, "2 дня"], [5, "5 дней"], [21, "21 день"]] as const) {
      const day = new Date("2026-10-24T00:00:00Z")
      day.setUTCDate(day.getUTCDate() + count)
      expect(noticesFor(snapshot, p, day.toISOString().slice(0, 10), "ru")[0]!.text).toContain(ending)
    }
    expect(noticesFor(snapshot, p, "2026-10-26", "en")[0]!.text).toContain("unconfirmed for 2 days")
    const digest = scheduledNotices({ ...snapshot, payments: [], forecast: [], budgets: [] }, { ...p, digest: true }, "Europe/Moscow", new Date("2026-10-23T09:00:00Z"), "en")
    expect(digest[0]!.text).toBe("Summary for October 23\nNo upcoming payments or alerts.")
    expect(truncateMessage("😀".repeat(5000), 1000, "en")).toContain("Open the app")
    expect(truncateMessage("😀".repeat(5000), 1000, "ru")).toContain("Остальное")
  })
  it("honors crossing and daytime quiet hours and disabled quiet hours", () => {
    expect(isQuiet("23:59", "22:00", "08:00")).toBe(true)
    expect(isQuiet("07:59", "22:00", "08:00")).toBe(true)
    expect(isQuiet("08:00", "22:00", "08:00")).toBe(false)
    expect(isQuiet("12:00", "12:00", "14:00")).toBe(true)
    expect(isQuiet("12:00", "12:00", "12:00")).toBe(false)
  })
  it("uses household time zones, digests, month rollover and DST", () => {
    const midnight = new Date("2026-10-31T21:30:00Z")
    const digest = { ...p, digest: true, digestTime: "00:00", quietStart: "00:00", quietEnd: "00:00" }
    expect(scheduledNotices(snapshot, digest, "Europe/Moscow", midnight, "ru")[0]!.key).toBe("digest:family:2026-11-01")
    expect(scheduledNotices(snapshot, digest, "America/New_York", midnight, "ru")[0]!.key).toBe("digest:family:2026-10-31")
    expect(scheduledNotices(snapshot, { ...p, digest: true }, "Europe/Moscow", new Date("2026-10-23T05:30:00Z"), "ru")).toEqual([])
    expect(scheduledNotices(snapshot, { ...p, digest: true }, "Europe/Moscow", new Date("2026-10-23T06:01:00Z"), "ru")[0]!.kind).toBe("digest")
    expect(scheduledNotices(snapshot, p, "Europe/Moscow", midnight, "ru")).toEqual([])
    for (const iso of ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"]) expect(scheduledNotices(snapshot, digest, "Europe/Berlin", new Date(iso), "ru")[0]!.key).toBe("digest:family:2026-10-25")
  })
  it("bounds Unicode payloads and accepts only well-formed private updates and callbacks", () => {
    expect(truncateMessage("😀".repeat(5000)).length).toBeLessThan(4096)
    expect(parsePaymentCallback(`pay:${id}:2`)).toEqual({ id, version: 2 })
    expect(parsePaymentCallback(`pay:${id}:0`)).toBe(null)
    expect(parsePaymentCallback("pay:other:1")).toBe(null)
    expect(parseTelegramUpdate({ update_id: 1, message: { chat: { id: 1, type: "group" }, from: { id: 1 } } })).toBe(null)
    expect(parseTelegramUpdate({ update_id: 1, callback_query: { id: "cb", from: { id: 1 }, data: `pay:${id}:2`, message: { chat: { id: 1, type: "private" } } } })?.callback_query?.data).toBe(`pay:${id}:2`)
  })
})
