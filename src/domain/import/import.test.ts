import { importMessage, translateImportMessage } from "./messages"
import { describe, expect, it } from "vitest"
import { decodeCsv, detectDelimiter, parseCsv } from "./csv"
import { normalizeRow, parseAmount, parseDate } from "./normalize"
import { detectProfile, profileMapping } from "./profiles"
import { fingerprint, isTransferPair, reconcileMultiset } from "./matching"
import { compileRule, suggestCategory, type CategoryRule } from "./categories"
import { mappingSchema } from "./types"

const headers = ["account", "date", "amount", "currency", "description", "status", "mcc"]
const mapping = profileMapping("bestbudget-v1", headers)
const normalized = (amount = "-450.00", date = "2026-10-20") =>
  normalizeRow(["DEMO_A", date, amount, "RUB", "  MAGAZIN\u00a0PRIMER  ", "posted", "5411"], mapping, "bestbudget-v1", "CSV:2")

describe("statement decoding and CSV", () => {
  it("strictly decodes UTF-8/BOM, UTF-16 BOM and explicit CP1251", () => {
    expect(decodeCsv(new TextEncoder().encode("\ufeffПривет"))).toBe("Привет")
    expect(decodeCsv(Uint8Array.of(0xff, 0xfe, 0x1f, 0x04))).toBe("П")
    expect(() => decodeCsv(Uint8Array.of(0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2))).toThrow(/Windows-1251/)
    expect(decodeCsv(Uint8Array.of(0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2), "windows-1251")).toBe("Привет")
    expect(() => decodeCsv(Uint8Array.of(0, 1, 2))).toThrow()
  })
  it("parses delimiters, quotes, multiline fields and trailing empty cells", () => {
    const text = 'date;description;amount\r\n2026-10-20;"Shop; say ""hello""\nsecond line";-450.00\r\n2026-10-21;;\r\n'
    expect(detectDelimiter(text)).toBe(";")
    expect(parseCsv(text, ";")).toEqual([
      ["date", "description", "amount"],
      ["2026-10-20", 'Shop; say "hello"\nsecond line', "-450.00"],
      ["2026-10-21", "", ""],
    ])
    expect(() => parseCsv('a;"not closed', ";")).toThrow(/Незакрытые/)
    expect(() => parseCsv('a;"b"garbage', ";")).toThrow(/кавычки/)
    expect(detectDelimiter("a,b;c\n1,2;3")).toBeNull()
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t")
  })
})

describe("statement normalization", () => {
  it("parses exact minor units, Unicode spaces/minus and currency exponents", () => {
    for (const value of ["1 234,56", "1\u00a0234,56", "1\u202f234,56"]) expect(parseAmount(value, "RUB", ",")).toBe(123456)
    expect(parseAmount("−1 234,56", "RUB", ",")).toBe(-123456)
    expect(parseAmount("1234", "JPY", ".")).toBe(1234)
    expect(parseAmount("1.234", "BHD", ".")).toBe(1234)
    for (const value of ["1,234.56", "1.234", "NaN", "1e4", "", "9007199254740993"]) expect(() => parseAmount(value, "RUB", ".")).toThrow()
    expect(() => parseAmount("1.1", "JPY", ".")).toThrow()
  })
  it("distinguishes signed, two-column and direction amounts; rejects two nonzero sides", () => {
    const m = mappingSchema.parse({
      columns: { date: 0, income: 1, expense: 2, description: 3 },
      amountMode: "separate",
      decimal: ",",
      assumePosted: true,
    })
    expect(normalizeRow(["2026-10-20", "", "1 234,56", "Shop"], m, "custom", "2").amountMinorSigned).toBe(-123456)
    expect(normalizeRow(["2026-10-20", "0", "", "Shop"], m, "custom", "2").errors).toContain(importMessage("zeroAmount"))
    expect(normalizeRow(["2026-10-20", "100", "100", "Shop"], m, "custom", "2").errors.length).toBeGreaterThan(0)
    const direction = mappingSchema.parse({
      columns: { date: 0, amount: 1, direction: 2, description: 3 },
      amountMode: "direction",
      assumePosted: true,
    })
    expect(normalizeRow(["2026-10-20", "5.50", "расход", "Shop"], direction, "custom", "2").amountMinorSigned).toBe(-550)
    expect(normalizeRow(["2026-10-20", "5.50", "other", "Shop"], direction, "custom", "2").errors.length).toBeGreaterThan(0)
  })
  it("parses explicit date formats and prefers booking date", () => {
    expect(parseDate("01/02/2026", "dmy")).toBe("2026-02-01")
    expect(parseDate("01/02/2026", "mdy")).toBe("2026-01-02")
    expect(() => parseDate("01/02/26", "dmy")).toThrow()
    expect(() => parseDate("31.02.2026", "dmy")).toThrow()
    expect(() => parseDate({ number: "45000" }, "iso")).toThrow(importMessage("excelDate"))
    expect(parseDate({ date: "2026-10-20T12:00:00" }, "dmy")).toBe("2026-10-20")
    const h = ["Дата операции", "Дата платежа", "Сумма платежа", "Валюта платежа", "Описание", "Статус"]
    const row = normalizeRow(
      ["20.10.2026 18:20:00", "21.10.2026", "-450,00", "RUB", "Shop", "OK"],
      profileMapping("tbank-csv-legacy-candidate", h),
      "tbank-csv-legacy-candidate",
      "2",
    )
    expect(row).toMatchObject({
      operationAtRaw: "20.10.2026 18:20:00",
      bookingDateRaw: "21.10.2026",
      effectiveDate: "2026-10-21",
      amountMinorSigned: -45000,
      status: "posted",
    })
    expect(row.warnings).toContainEqual(importMessage("experimental"))
  })
  it("detects only known headers, independently of order/case/BOM", () => {
    expect(detectProfile(["\ufeff DATE ", "CURRENCY", "account", " description ", "amount"])).toBe("bestbudget-v1")
    expect(profileMapping("bestbudget-v1", ["currency", "date", "account", "amount", "description"]).columns.amount).toBe(3)
    expect(detectProfile(["Сбер", "Дата", "Сумма"])).toBe("custom")
    expect(() => profileMapping("bestbudget-v1", ["date", " DATE "])).toThrow(importMessage("duplicateHeader", { header: "date" }))
  })
  it("retains pending/rejected/unknown rows without converting them to facts", () => {
    for (const status of ["pending", "rejected", "weird"]) {
      const row = normalizeRow(["DEMO_A", "2026-10-20", "-1.00", "RUB", "Shop", status, ""], mapping, "bestbudget-v1", "2")
      expect(row.status).toBe(status === "weird" ? "unknown" : status)
      expect(row.warnings).not.toHaveLength(0)
      expect(row.errors).toHaveLength(0)
      if (status === "pending") expect(row.warnings).toContain(importMessage("pending"))
      if (status === "rejected") expect(row.warnings).toContain(importMessage("rejected"))
    }
  })
})

describe("identity, categories and transfers", () => {
  it("fingerprints include account/currency, signed amount, source timestamp, description and reference", () => {
    const row = normalized()
    expect(row.descriptionNormalized).toBe("magazin primer")
    const fp = fingerprint("A", row)
    expect(fingerprint("A", { ...row, descriptionRaw: "other" })).toBe(fp)
    for (const patch of [
      { currency: "USD" },
      { amountMinorSigned: 45000 },
      { operationAtRaw: "2026-10-20 12:00:00" },
      { externalId: "ref" },
      { descriptionNormalized: "other" },
    ])
      expect(fingerprint("A", { ...row, ...patch })).not.toBe(fp)
    expect(fingerprint("B", row)).not.toBe(fp)
  })
  it("reconciles multiplicities instead of imposing uniqueness on identical purchases", () => {
    expect(reconcileMultiset(["a", "a", "b", "a"], ["a", "b"])).toEqual([true, false, true, false])
    expect(reconcileMultiset(["a", "a"], [])).toEqual([false, false])
  })
  it("applies household rules first, then MCC, bank category, uncategorized", () => {
    const cats = [
      { id: "food", name: "Продукты", kind: "expense", archivedAt: null },
      { id: "custom", name: "Прочее", kind: "expense", archivedAt: null },
    ]
    const rule: CategoryRule = {
      id: "1",
      version: 2,
      categoryId: "custom",
      descriptionMode: "regex",
      descriptionPattern: "magazin.*primer",
      mcc: "5411",
      minAmount: 100,
      maxAmount: 50000,
      priority: 100,
    }
    expect(suggestCategory(normalized(), [rule], cats)).toEqual({
      categoryId: "custom",
      source: importMessage("rule", { version: 2, priority: 100 }),
    })
    expect(suggestCategory(normalized(), [], cats).categoryId).toBe("food")
    expect(suggestCategory({ ...normalized(), mcc: null, bankCategory: "Прочее" }, [], cats).categoryId).toBe("custom")
    expect(suggestCategory({ ...normalized(), mcc: null }, [], cats).categoryId).toBeNull()
    expect(() => compileRule("(?=x)")).toThrow()
    expect(compileRule("(a+)+$").test("a".repeat(5000) + "!")).toBe(false)
  })
  it("requires distinct own accounts, opposite signed amounts, same currency and a date window", () => {
    const a = { accountId: "A", normalized: normalized("-20.00") },
      b = { accountId: "B", normalized: normalized("20.00", "2026-10-21") }
    expect(isTransferPair(a, b)).toBe(true)
    expect(isTransferPair(a, { ...b, accountId: "A" })).toBe(false)
    expect(isTransferPair(a, { ...b, normalized: { ...b.normalized, currency: "USD" } })).toBe(false)
    expect(isTransferPair(a, { ...b, normalized: normalized("20.00", "2026-10-25") })).toBe(false)
    expect(isTransferPair(a, { ...b, normalized: { ...b.normalized, status: "pending" } })).toBe(false)
  })
})

describe("persisted import messages", () => {
  it("renders message codes in the selected language, including candidate dates and user data", () => {
    const candidate = importMessage("planned", { date: "2026-10-20", title: "Оплата школы" })
    expect(translateImportMessage(candidate, "en")).toBe("Confirm planned: Oct 20 · Оплата школы")
    expect(translateImportMessage(candidate, "ru")).toBe("Подтвердить плановую: 20 окт. · Оплата школы")
    expect(translateImportMessage(importMessage("accountRequired", { name: "" }), "en")).toBe("Match an account: no account specified")
    expect(translateImportMessage(importMessage("pending"), "en")).toContain("not posted")
  })
  it("recognises old draft messages without translating bank descriptions", () => {
    expect(translateImportMessage("Уже есть: 2026-10-20 · Оплата школы", "en")).toBe("Already exists: Oct 20 · Оплата школы")
    expect(translateImportMessage("Валюта строки USD не совпадает со счётом RUB", "en")).toBe(
      "Row currency USD does not match account currency RUB",
    )
    expect(translateImportMessage("Оплата школы", "en")).toBe("Оплата школы")
    expect(translateImportMessage('bb-import:{"code":"unknown","params":{}}', "en")).toContain("unknown")
  })
})
