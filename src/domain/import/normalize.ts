import bankData from "./bank-data.json"
import { importMessage } from "./messages"
import enTransactions from "../../../messages/en/transactions.json"
import ruTransactions from "../../../messages/ru/transactions.json"
import { CURRENCIES, currencyExponent } from "@/lib/currencies"
import { isIsoDate } from "@/lib/dates"
import { PENDING_ROW_MESSAGE, REJECTED_ROW_MESSAGE, type ColumnField, type ColumnMapping, type IncomingRow } from "./types"

export type StatementCell = string | { number: string } | { date: string }
export const cellText = (cell: StatementCell | undefined): string =>
  typeof cell === "string" ? cell : cell && "number" in cell ? cell.number : (cell?.date ?? "")
export const normalizeDescription = (s: string) => s.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase()

export function parseAmount(value: string, currency: string, decimal: "." | ","): number {
  if (!Object.hasOwn(CURRENCIES, currency)) throw new Error(importMessage("unsupportedCurrency"))
  const s = value
    .replace(/[ \u00a0\u202f\u2009]/g, "")
    .replace(/\u2212/g, "-")
    .trim()
  const exponent = currencyExponent(currency)
  const separator = decimal === "." ? "\\." : ","
  if (!new RegExp(`^[+-]?\\d+(?:${separator}\\d{1,${Math.max(1, exponent)}})?$`).test(s)) throw new Error(importMessage("invalidAmount"))
  const [whole = "0", fraction = ""] = s.replace(/^[+-]/, "").split(decimal)
  if (fraction.length > exponent) throw new Error(importMessage("amountPrecision"))
  const minor = BigInt(whole) * 10n ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, "0") || "0")
  if (minor > 100_000_000_000_000n) throw new Error(importMessage("amountTooLarge"))
  return Number(minor) * (s.startsWith("-") ? -1 : 1)
}

export function parseDate(value: StatementCell, format: ColumnMapping["dateFormat"]): string {
  if (typeof value !== "string") {
    if ("date" in value && isIsoDate(value.date.slice(0, 10))) return value.date.slice(0, 10)
    throw new Error(importMessage("excelDate"))
  }
  const text = value.trim()
  let date: string
  if (format === "iso") {
    if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(text)) throw new Error(importMessage("isoDate"))
    date = text.slice(0, 10)
    const time = text.slice(11).split(":")
    if (time.length > 1 && (Number(time[0]) > 23 || Number(time[1]) > 59 || Number(time[2] ?? 0) > 59))
      throw new Error(importMessage("invalidTime"))
  } else {
    const match = /^(\d{2})[./](\d{2})[./](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text)
    if (!match) throw new Error(importMessage("fullYear"))
    const [, a, b, year, hour, minute, second] = match
    if (hour && (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59)) throw new Error(importMessage("invalidTime"))
    date = `${year}-${format === "mdy" ? a : b}-${format === "mdy" ? b : a}`
  }
  if (!isIsoDate(date) || date < "1900-01-01" || date > "9998-12-31") throw new Error(importMessage("invalidDate"))
  return date
}

export function normalizeRow(cells: StatementCell[], mapping: ColumnMapping, profile: string, rowLocator: string): IncomingRow {
  const getCell = (field: ColumnField) => (mapping.columns[field] === undefined ? "" : (cells[mapping.columns[field]] ?? ""))
  const get = (field: ColumnField) => cellText(getCell(field)).trim()
  const nullable = (field: ColumnField) => get(field) || null
  const currency = (get("currency") || mapping.currency).toUpperCase()
  const row: IncomingRow = {
    rowLocator,
    accountHint: nullable("account"),
    externalId: nullable("externalId"),
    operationAtRaw: nullable("date"),
    bookingDateRaw: nullable("bookingDate"),
    effectiveDate: null,
    amountMinorSigned: null,
    currency,
    originalAmountMinorSigned: null,
    originalCurrency: nullable("originalCurrency")?.toUpperCase() ?? null,
    status: "unknown",
    exportStatus: null,
    descriptionRaw: cellText(getCell("description")),
    descriptionNormalized: normalizeDescription(get("description")),
    mcc: nullable("mcc"),
    bankCategory: nullable("bankCategory"),
    cardHint: nullable("card"),
    counterpartyHint: nullable("counterparty"),
    balanceAfterMinor: null,
    confidence: "high",
    warnings: [],
    errors: [],
    toAccountHint: nullable("toAccount"),
    toAmount: null,
    toCurrency: nullable("toCurrency")?.toUpperCase() ?? null,
    typeHint: nullable("type"),
    kindHint: nullable("kindHint"),
    bankMetadata: Object.fromEntries(
      ["cashback", "bonuses"].flatMap((field) => (get(field as ColumnField) ? [[field, get(field as ColumnField)]] : [])),
    ),
    title: nullable("title"),
  }
  if (["bestbudget-v1", "bestbudget-export", "tbank-csv-legacy-candidate"].includes(profile) && !get("currency"))
    row.errors.push(importMessage("requiredCurrency"))
  const attempt = <T>(fn: () => T): T | null => {
    try {
      return fn()
    } catch (e) {
      row.errors.push(e instanceof Error ? e.message : importMessage("rowError"))
      return null
    }
  }
  const money = (field: ColumnField, code = currency) => {
    const cell = getCell(field)
    return parseAmount(cellText(cell), code, typeof cell === "object" && "number" in cell ? "." : mapping.decimal)
  }
  row.effectiveDate = attempt(() => parseDate(row.bookingDateRaw ? getCell("bookingDate") : getCell("date"), mapping.dateFormat))
  if (row.bookingDateRaw && row.operationAtRaw) attempt(() => parseDate(getCell("date"), mapping.dateFormat))
  row.amountMinorSigned = attempt(() => {
    if (mapping.amountMode === "signed") return money("amount")
    if (mapping.amountMode === "separate") {
      const income = get("income") ? money("income") : 0
      const expense = get("expense") ? money("expense") : 0
      if (income < 0 || expense < 0 || (income && expense) || (!get("income") && !get("expense")))
        throw new Error(importMessage("separateAmounts"))
      return income - expense
    }
    const direction = normalizeDescription(get("direction"))
    if (![normalizeDescription(mapping.incomeValue), normalizeDescription(mapping.expenseValue)].includes(direction))
      throw new Error(importMessage("unknownDirection"))
    const absolute = money("amount")
    if (absolute < 0) throw new Error(importMessage("unsignedAmount"))
    return absolute * (direction === normalizeDescription(mapping.incomeValue) ? 1 : -1)
  })
  if (row.amountMinorSigned === 0) row.errors.push(importMessage("zeroAmount"))
  if (get("originalAmount")) row.originalAmountMinorSigned = attempt(() => money("originalAmount", row.originalCurrency ?? ""))
  if (get("balance")) row.balanceAfterMinor = attempt(() => money("balance"))
  if (get("toAmount")) row.toAmount = attempt(() => money("toAmount", row.toCurrency ?? ""))
  if (row.mcc && !/^\d{4}$/.test(row.mcc)) row.errors.push(importMessage("invalidMcc"))
  let status = normalizeDescription(get("status"))
  if (profile === "bestbudget-export") {
    // Normalize our localized export metadata to the existing internal import hints.
    for (const key of ["income", "expense", "transfer"] as const) {
      if (row.typeHint === enTransactions.types[key]) row.typeHint = ruTransactions.types[key]
    }
    for (const key of ["posted", "planned", "skipped"] as const) {
      if (status === normalizeDescription(enTransactions.statuses[key])) status = normalizeDescription(ruTransactions.statuses[key])
    }
    row.status =
      status === bankData.markers.posted
        ? "posted"
        : status === bankData.markers.planned
          ? "pending"
          : status === bankData.markers.skipped
            ? "rejected"
            : "unknown"
    row.exportStatus =
      status === bankData.markers.posted
        ? "posted"
        : status === bankData.markers.planned
          ? "planned"
          : status === bankData.markers.skipped
            ? "skipped"
            : null
    // Reverse the single quote added by our CSV-injection escaping, only for our own export.
    row.descriptionRaw = row.descriptionRaw.replace(/^'(?='*[=+\-@\t\r])/, "")
    row.descriptionNormalized = normalizeDescription(row.descriptionRaw)
    row.title = row.title?.replace(/^'(?='*[=+\-@\t\r])/, "") ?? null
    row.accountHint = row.accountHint?.replace(/^'(?='*[=+\-@\t\r])/, "") ?? null
    row.toAccountHint = row.toAccountHint?.replace(/^'(?='*[=+\-@\t\r])/, "") ?? null
    row.bankCategory = row.bankCategory?.replace(/^'(?='*[=+\-@\t\r])/, "") ?? null
    if (row.typeHint === bankData.markers.transfer && row.amountMinorSigned !== null)
      row.amountMinorSigned = -Math.abs(row.amountMinorSigned)
    if (![bankData.markers.expenseType, bankData.markers.incomeType, bankData.markers.transfer].includes(row.typeHint ?? ""))
      row.errors.push(importMessage("unknownExportType"))
    if (row.typeHint === bankData.markers.expenseType && (row.amountMinorSigned ?? 0) >= 0)
      row.errors.push(importMessage("negativeExpense"))
    if (row.typeHint === bankData.markers.incomeType && (row.amountMinorSigned ?? 0) <= 0) row.errors.push(importMessage("positiveIncome"))
    if (
      row.typeHint === bankData.markers.transfer &&
      row.currency === row.toCurrency &&
      row.toAmount !== Math.abs(row.amountMinorSigned ?? 0)
    )
      row.errors.push(importMessage("sameCurrencyTransfer"))
  } else if (profile === "tbank-csv-legacy-candidate") row.status = status === "ok" && !!row.bookingDateRaw ? "posted" : "unknown"
  else
    row.status =
      status === "posted" || (!status && mapping.assumePosted)
        ? "posted"
        : status === "pending"
          ? "pending"
          : status === "rejected"
            ? "rejected"
            : "unknown"
  if (row.exportStatus && row.exportStatus !== "posted")
    row.warnings.push(importMessage(row.exportStatus === "planned" ? "exportPlanned" : "exportSkipped"))
  else if (row.status === "pending") row.warnings.push(PENDING_ROW_MESSAGE)
  else if (row.status === "rejected") row.warnings.push(REJECTED_ROW_MESSAGE)
  else if (row.status !== "posted") row.warnings.push(importMessage("unknownStatus"))
  if (profile.startsWith("tbank")) row.warnings.push(importMessage("experimental"))
  if (row.descriptionRaw.length > 1000) row.errors.push(importMessage("longDescription"))
  if (row.title && row.title.length > 120) row.errors.push(importMessage("longTitle"))
  if (!Object.hasOwn(CURRENCIES, currency)) row.errors.push(importMessage("noConversion"))
  row.errors = [...new Set(row.errors)]
  if (row.errors.length || row.warnings.length) row.confidence = "review"
  return row
}
