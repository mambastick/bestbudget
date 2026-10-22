/**
 * CSV for spreadsheet apps with Russian regional settings: ";" separator, CRLF, UTF-8 BOM.
 * Cells that a spreadsheet would treat as formulas are prefixed with a quote (CSV injection).
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (value: string | number | null | undefined) => {
    let s = value === null || value === undefined ? "" : String(value)
    const plainNumber = /^-?\d+(,\d+)?$/.test(s)
    if (/^[=+\-@\t\r]/.test(s) && !plainNumber) s = "'" + s
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return "\ufeff" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n"
}

/** 123456 kopecks → "1234,56" (no grouping: spreadsheets parse it as a number). */
export function csvAmount(minor: number): string {
  const sign = minor < 0 ? "-" : ""
  const abs = Math.abs(minor)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`
}
