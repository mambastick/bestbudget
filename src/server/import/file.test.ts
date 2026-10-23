import { describe, expect, it } from "vitest"
import { strToU8, zipSync } from "fflate"
import { fileOptionsSchema } from "@/domain/import/types"
import { normalizeRow } from "@/domain/import/normalize"
import { profileMapping } from "@/domain/import/profiles"
import { inspectXlsx, readStatement } from "./file"

function workbook(date1904 = false, serial = 46315, extra: Record<string, string> = {}, cell = "") {
  const xml = (s: string) => strToU8(s)
  return zipSync({
    "[Content_Types].xml": xml(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    ),
    "xl/workbook.xml": xml(
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${date1904 ? 1 : 0}"/><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": xml(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    ),
    "xl/styles.xml": xml(
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    ),
    "xl/worksheets/sheet1.xml": xml(
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${["account", "date", "amount", "currency", "description"].map((s, i) => `<c r="${String.fromCharCode(65 + i)}1" t="inlineStr"><is><t>${s}</t></is></c>`).join("")}</row><row r="2"><c r="A2" t="inlineStr"><is><t>DEMO_A</t></is></c><c r="B2" s="1"><v>${serial}</v></c><c r="C2"><v>-1234.56</v></c><c r="D2" t="inlineStr"><is><t>RUB</t></is></c><c r="E2" t="inlineStr"><is><t>Synthetic shop</t></is></c>${cell}</row></sheetData></worksheet>`,
    ),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, xml(v)])),
  })
}
const options = fileOptionsSchema.parse({})

describe("bounded XLSX reader", () => {
  it("detects by contents, reads typed 1900/1904 dates and exact numeric amounts", async () => {
    const serial = Math.round((Date.UTC(2026, 9, 20) - Date.UTC(1899, 11, 30)) / 86400000)
    for (const epoch1904 of [false, true]) {
      const bytes = workbook(epoch1904, serial - (epoch1904 ? 1462 : 0))
      const result = await readStatement(bytes, options)
      expect(result.kind).toBe("xlsx")
      expect(result.sheets).toEqual(["Synthetic"])
      expect(result.rows[1]![1]).toEqual({ date: "2026-10-20T00:00:00" })
      expect(result.rows[1]![2]).toEqual({ number: "-1234.56" })
      const row = normalizeRow(
        result.rows[1]!,
        profileMapping("bestbudget-v1", ["account", "date", "amount", "currency", "description"]),
        "bestbudget-v1",
        "2",
      )
      expect(row).toMatchObject({ effectiveDate: "2026-10-20", amountMinorSigned: -123456, errors: [] })
    }
  })
  it("rejects formulas, macros, external links, XML entities and sparse huge dimensions before parsing", async () => {
    await expect(readStatement(workbook(false, 46315, {}, '<c r="F2"><f>1+1</f><v>2</v></c>'), options)).rejects.toThrow(/Формулы/)
    await expect(readStatement(workbook(false, 46315, { "xl/vbaProject.bin": "macro" }), options)).rejects.toThrow(/Макросы/)
    await expect(readStatement(workbook(false, 46315, { "xl/externalLinks/link.xml": "link" }), options)).rejects.toThrow(/внешние ссылки/)
    await expect(
      readStatement(workbook(false, 46315, { "xl/test.xml": '<!DOCTYPE foo [<!ENTITY x "x">]><foo/>' }), options),
    ).rejects.toThrow(/Формулы/)
    await expect(readStatement(workbook(false, 46315, {}, '<c r="XFD1048576"><v>1</v></c>'), options)).rejects.toThrow(/лимит/)
    await expect(
      readStatement(
        workbook(false, 46315, { "xl/test.rels": '<Relationship TargetMode="External" Target="https://example.test"/>' }),
        options,
      ),
    ).rejects.toThrow(/внешние ссылки/)
    await expect(
      readStatement(workbook(false, 46315, { "xl/test.rels": '<Relationship TargetMode="Internal" Target="styles.xml"/>' }), options),
    ).resolves.toMatchObject({ kind: "xlsx" })
  })
  it("bounds actual inflation, including a highly compressed bomb", () => {
    const bomb = zipSync({
      "xl/bomb.xml": strToU8(" ".repeat(41 * 1024 * 1024)),
      "xl/workbook.xml": strToU8("<workbook/>"),
      "[Content_Types].xml": strToU8("<Types/>"),
    })
    expect(bomb.length).toBeLessThan(100_000)
    expect(() => inspectXlsx(bomb)).toThrow(/лимит распаковки/)
    const forged = bomb.slice()
    const view = new DataView(forged.buffer)
    for (let i = 0; i + 46 < forged.length; i++) {
      if (view.getUint32(i, true) === 0x04034b50) view.setUint32(i + 22, 1, true)
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 1, true)
    }
    expect(() => inspectXlsx(forged)).toThrow(/лимит распаковки/)
    const sparse = '<worksheet><sheetData><row r="50000"><c r="CV50000"><v>1</v></c></row></sheetData></worksheet>'
    expect(() => inspectXlsx(workbook(false, 46315, { "xl/worksheets/sheet2.xml": sparse, "xl/worksheets/sheet3.xml": sparse }))).toThrow(
      /разреженная/,
    )
  })
  it("explains unsupported XLS/PDF and non-OOXML ZIP", async () => {
    await expect(readStatement(Uint8Array.of(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1), options)).rejects.toThrow(
      /сохраните как XLSX\/CSV/,
    )
    await expect(readStatement(strToU8("%PDF-1.7"), options)).rejects.toThrow(/PDF пока/)
    await expect(readStatement(zipSync({ "text.txt": strToU8("test") }), options)).rejects.toThrow(/не является/)
    await expect(readStatement(new Uint8Array(10 * 1024 * 1024 + 1), options)).rejects.toThrow(/до 10 МБ/)
  })
  it("accepts the 50,000-row boundary and rejects one more data row", async () => {
    const csv = "a;b\n" + "1;2\n".repeat(50_000)
    expect((await readStatement(strToU8(csv), options)).rows).toHaveLength(50_001)
    await expect(readStatement(strToU8(csv + "1;2\n"), options)).rejects.toThrow(/50_000|50000|50 000/)
  })
})
