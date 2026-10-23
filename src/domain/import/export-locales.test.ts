import { describe, expect, it } from "vitest"
import ru from "../../../messages/ru/transactions.json"
import en from "../../../messages/en/transactions.json"
import { csvAmount, toCsv } from "../csv"
import { decodeCsv, detectDelimiter, parseCsv } from "./csv"
import { normalizeRow } from "./normalize"
import { detectProfile, profileMapping } from "./profiles"

describe("localized BestBudget export round-trip", () => {
  it.each(["ru", "en"])("recognizes %s exports, preserves signed minor units, statuses and literal user data", (locale) => {
    const t = locale === "ru" ? ru : en
    const headers = Object.values(t.csv)
    const rows = (["posted", "planned", "skipped"] as const).map((status) => [
      "2026-10-20", t.types.transfer, t.statuses[status], "=Мой перевод, demo", "", "Основной", "USD savings",
      csvAmount(9500_00, "RUB", locale), "RUB", csvAmount(100_00, "USD", locale), "USD", "'@Заметка", "Demo", `id-${status}`,
    ])
    const text = decodeCsv(new TextEncoder().encode(toCsv([headers, ...rows], locale)))
    const delimiter = detectDelimiter(text)!
    expect(delimiter).toBe(locale === "ru" ? ";" : ",")
    const [parsedHeaders, ...parsedRows] = parseCsv(text, delimiter)
    expect(detectProfile(parsedHeaders!)).toBe("bestbudget-export")
    expect(detectProfile(parsedHeaders!.slice(0, -1))).toBe("bestbudget-export")
    expect(profileMapping("bestbudget-export", parsedHeaders!.slice(0, -1)).columns.externalId).toBeUndefined()
    const mapping = profileMapping("bestbudget-export", parsedHeaders!)
    for (const [i, row] of parsedRows.entries()) {
      const normalized = normalizeRow(row, mapping, "bestbudget-export", String(i))
      expect(normalized.errors).toEqual([])
      expect(normalized).toMatchObject({ amountMinorSigned: -9500_00, toAmount: 100_00, typeHint: "Перевод", title: "=Мой перевод, demo", descriptionRaw: "'@Заметка", exportStatus: ["posted", "planned", "skipped"][i] })
    }
  })
})
