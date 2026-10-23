import { describe, expect, it } from "vitest"
import { createTranslator } from "next-intl"
import { browserLocale, resolveLocale } from "./locale"
import { loadMessages } from "./messages"
import { formatDateFull, formatMonth, formatRelativeDay, todayIn } from "@/lib/dates"
import { formatMoney, minorToInput, parseMoney } from "@/lib/money"
import { formatMoneyInput } from "@/components/app/money-input"
import { plural } from "@/lib/plural"

describe("request locale", () => {
  it.each([
    ["en-US,en;q=0.9,ru;q=0.8", "en"], ["de,ru-RU;q=0.8,en;q=0.3", "ru"],
    ["en;q=0.2,ru;q=0.9", "ru"], ["ru;q=0,en;q=0.5", "en"],
    ["RU-by,en;q=0.5", "ru"], ["ru;q=0.5,en;q=0.5", "ru"],
    ["ru;q=bad,en;q=0.2", "en"], ["ru;q=1.2,en;q=0.4", "en"], ["de,*;q=0.5", "en"], [null, "en"],
  ])("negotiates %s", (header, locale) => expect(browserLocale(header)).toBe(locale))

  it("applies user, cookie and browser precedence with invalid values ignored", () => {
    expect(resolveLocale({ user: "en", cookie: "ru", acceptLanguage: "ru" })).toBe("en")
    expect(resolveLocale({ user: null, cookie: "ru", acceptLanguage: "en" })).toBe("ru")
    expect(resolveLocale({ user: "de", cookie: "invalid", acceptLanguage: "ru" })).toBe("ru")
    expect(resolveLocale({})).toBe("en")
  })
})

describe("locale-aware formatting", () => {
  it("formats currency symbols, grouping and decimals with Intl", () => {
    expect(formatMoney(123456, "RUB", { locale: "ru" })).toMatch(/1\s234,56\s₽/)
    expect(formatMoney(123456, "USD", { locale: "en" })).toBe("$1,234.56")
    expect(formatMoney(-123456, "USD", { locale: "en", sign: true })).toBe("−$1,234.56")
    expect(minorToInput(123456, "USD", "en")).toBe("1234.56")
    expect(minorToInput(123456, "RUB", "ru")).toBe("1234,56")
  })

  it("formats calendar dates without a machine timezone conversion", () => {
    expect(formatDateFull("2026-10-23", "en")).toBe("October 23, 2026")
    expect(formatDateFull("2026-10-23", "ru")).toContain("23 октября 2026")
    expect(formatMonth("2026-10-23", "en")).toBe("October 2026")
    expect(formatRelativeDay("2026-10-24", "2026-10-23", "en")).toBe("tomorrow")
    expect(formatRelativeDay("2026-10-22", "2026-10-23", "ru")).toBe("вчера")
    expect(todayIn("Europe/Moscow", new Date("2026-10-23T22:00:00Z"))).toBe("2026-10-24")
  })

  it.each(["ru", "en"])("round-trips inputs in %s without floating point arithmetic", (locale) => {
    for (const [currency, values] of [["RUB", [0, 1, 123456, 9_000_000_000_001]], ["JPY", [0, 1234]], ["BHD", [1, 1234]]] as const) {
      for (const value of values) expect(parseMoney(formatMoneyInput(minorToInput(value, currency, locale), currency, locale), currency)).toBe(value)
    }
    expect(formatMoneyInput("1234,56", "RUB", locale)).toBe(locale === "ru" ? "1\u2009234,56" : "1\u2009234.56")
    expect(parseMoney("1,234.56")).toBe(123456)
    expect(parseMoney("1.234,56")).toBe(123456)
    expect(parseMoney("1\u202f234,56")).toBe(123456)
    for (const input of ["1,234", "12,34.56", "1.2.3", "-1", "1e3", "Infinity", "9007199254740992"]) expect(parseMoney(input)).toBeNull()
  })

  it("uses ICU one/few/many/other for Russian and locale-aware plural rules", async () => {
    const t = createTranslator({ locale: "ru", messages: await loadMessages("ru"), namespace: "errors" })
    for (const [count, ending] of [[1, "1 блокировка"], [2, "2 блокировки"], [5, "5 блокировок"], [21, "21 блокировка"], [1.5, "1,5 блокировки"]] as const) {
      expect(t("import.undoBlocked", { rows: "1", removed: "—", shared: "—", changed: "1", count })).toContain(ending)
    }
    expect(plural(2, "account", "unused", "unused", "en", "accounts")).toBe("accounts")
  })
})

it.each(["ru", "en"] as const)("every %s message compiles as ICU with named arguments", async (locale) => {
  const messages = await loadMessages(locale)
  const errors: string[] = []
  function visit(value: unknown, key: string) {
    if (typeof value === "string") {
      const values: Record<string, string | number | ((chunks: React.ReactNode) => React.ReactNode)> = {}
      for (const match of value.matchAll(/\{([a-zA-Z_]\w*)(?:,\s*(plural|selectordinal|number|date|time|select))?/g)) values[match[1]!] = match[2] && match[2] !== "select" ? 2 : "Example"
      for (const match of value.matchAll(/<([a-zA-Z_]\w*)>/g)) values[match[1]!] = (chunks) => chunks
      const t = createTranslator({ locale, messages: { message: value }, onError: (error) => errors.push(`${key}: ${error.message}`) })
      t.rich("message", values)
    } else if (value && typeof value === "object") {
      for (const [child, text] of Object.entries(value)) visit(text, key ? `${key}.${child}` : child)
    }
  }
  visit(messages, "")
  expect(errors).toEqual([])
})
