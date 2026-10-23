import { CURRENCIES, currencyExponent } from "@/lib/currencies"
import { isIsoDate } from "@/lib/dates"
import { PENDING_ROW_MESSAGE, REJECTED_ROW_MESSAGE, type ColumnField, type ColumnMapping, type IncomingRow } from "./types"

export type StatementCell = string | { number: string } | { date: string }
export const cellText = (cell: StatementCell | undefined): string =>
  typeof cell === "string" ? cell : cell && "number" in cell ? cell.number : (cell?.date ?? "")
export const normalizeDescription = (s: string) => s.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase()

export function parseAmount(value: string, currency: string, decimal: "." | ","): number {
  if (!Object.hasOwn(CURRENCIES, currency)) throw new Error("Валюта не поддерживается; укажите ISO-код")
  const s = value
    .replace(/[ \u00a0\u202f\u2009]/g, "")
    .replace(/\u2212/g, "-")
    .trim()
  const exponent = currencyExponent(currency)
  const separator = decimal === "." ? "\\." : ","
  if (!new RegExp(`^[+-]?\\d+(?:${separator}\\d{1,${Math.max(1, exponent)}})?$`).test(s))
    throw new Error("Некорректная сумма или десятичный разделитель")
  const [whole = "0", fraction = ""] = s.replace(/^[+-]/, "").split(decimal)
  if (fraction.length > exponent) throw new Error("Слишком много знаков после разделителя")
  const minor = BigInt(whole) * 10n ** BigInt(exponent) + BigInt(fraction.padEnd(exponent, "0") || "0")
  if (minor > 100_000_000_000_000n) throw new Error("Слишком большая сумма")
  return Number(minor) * (s.startsWith("-") ? -1 : 1)
}

export function parseDate(value: StatementCell, format: ColumnMapping["dateFormat"]): string {
  if (typeof value !== "string") {
    if ("date" in value && isIsoDate(value.date.slice(0, 10))) return value.date.slice(0, 10)
    throw new Error("Число Excel не помечено как дата. Задайте формат даты в книге.")
  }
  const text = value.trim()
  let date: string
  if (format === "iso") {
    if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(text)) throw new Error("Ожидается дата YYYY-MM-DD")
    date = text.slice(0, 10)
    const time = text.slice(11).split(":")
    if (time.length > 1 && (Number(time[0]) > 23 || Number(time[1]) > 59 || Number(time[2] ?? 0) > 59))
      throw new Error("Некорректное время")
  } else {
    const match = /^(\d{2})[./](\d{2})[./](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text)
    if (!match) throw new Error("Ожидается дата с четырёхзначным годом")
    const [, a, b, year, hour, minute, second] = match
    if (hour && (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59)) throw new Error("Некорректное время")
    date = `${year}-${format === "mdy" ? a : b}-${format === "mdy" ? b : a}`
  }
  if (!isIsoDate(date) || date < "1900-01-01" || date > "9998-12-31") throw new Error("Некорректная дата")
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
    row.errors.push("Валюта движения обязательна в каждой строке этого профиля")
  const attempt = <T>(fn: () => T): T | null => {
    try {
      return fn()
    } catch (e) {
      row.errors.push(e instanceof Error ? e.message : "Ошибка строки")
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
        throw new Error("Приход и расход: заполните только одну неотрицательную сумму")
      return income - expense
    }
    const direction = normalizeDescription(get("direction"))
    if (![normalizeDescription(mapping.incomeValue), normalizeDescription(mapping.expenseValue)].includes(direction))
      throw new Error("Неизвестное направление операции")
    const absolute = money("amount")
    if (absolute < 0) throw new Error("Для направления нужна сумма без знака")
    return absolute * (direction === normalizeDescription(mapping.incomeValue) ? 1 : -1)
  })
  if (row.amountMinorSigned === 0) row.errors.push("Нулевая сумма не создаёт операцию")
  if (get("originalAmount")) row.originalAmountMinorSigned = attempt(() => money("originalAmount", row.originalCurrency ?? ""))
  if (get("balance")) row.balanceAfterMinor = attempt(() => money("balance"))
  if (get("toAmount")) row.toAmount = attempt(() => money("toAmount", row.toCurrency ?? ""))
  if (row.mcc && !/^\d{4}$/.test(row.mcc)) row.errors.push("MCC должен содержать четыре цифры")
  const status = normalizeDescription(get("status"))
  if (profile === "bestbudget-export") {
    row.status =
      status === "выполнена" ? "posted" : status === "запланирована" ? "pending" : status === "пропущена" ? "rejected" : "unknown"
    row.exportStatus =
      status === "выполнена" ? "posted" : status === "запланирована" ? "planned" : status === "пропущена" ? "skipped" : null
    // Reverse the single quote added by our CSV-injection escaping, only for our own export.
    row.descriptionRaw = row.descriptionRaw.replace(/^'(?='*[=+\-@\t\r])/, "")
    row.descriptionNormalized = normalizeDescription(row.descriptionRaw)
    row.title = row.title?.replace(/^'(?='*[=+\-@\t\r])/, "") ?? null
    row.accountHint = row.accountHint?.replace(/^'(?='*[=+\-@\t\r])/, "") ?? null
    row.toAccountHint = row.toAccountHint?.replace(/^'(?='*[=+\-@\t\r])/, "") ?? null
    row.bankCategory = row.bankCategory?.replace(/^'(?='*[=+\-@\t\r])/, "") ?? null
    if (row.typeHint === "Перевод" && row.amountMinorSigned !== null) row.amountMinorSigned = -Math.abs(row.amountMinorSigned)
    if (!["Расход", "Доход", "Перевод"].includes(row.typeHint ?? "")) row.errors.push("Неизвестный тип операции экспорта")
    if (row.typeHint === "Расход" && (row.amountMinorSigned ?? 0) >= 0) row.errors.push("Расход должен быть отрицательным")
    if (row.typeHint === "Доход" && (row.amountMinorSigned ?? 0) <= 0) row.errors.push("Доход должен быть положительным")
    if (row.typeHint === "Перевод" && row.currency === row.toCurrency && row.toAmount !== Math.abs(row.amountMinorSigned ?? 0))
      row.errors.push("В одной валюте суммы списания и зачисления должны совпадать")
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
    row.warnings.push(
      `Экспорт BestBudget: сохранить статус «${row.exportStatus === "planned" ? "запланирована" : "пропущена"}», без записи в факт`,
    )
  else if (row.status === "pending") row.warnings.push(PENDING_ROW_MESSAGE)
  else if (row.status === "rejected") row.warnings.push(REJECTED_ROW_MESSAGE)
  else if (row.status !== "posted") row.warnings.push("Статус не подтверждает проводку: строка доступна только для пропуска")
  if (profile.startsWith("tbank")) row.warnings.push("Экспериментальный профиль: проверьте знак, статус и дату проводки")
  if (row.descriptionRaw.length > 1000) row.errors.push("Описание длиннее 1000 символов")
  if (row.title && row.title.length > 120) row.errors.push("Название длиннее 120 символов")
  if (!Object.hasOwn(CURRENCIES, currency)) row.errors.push("Валюта не поддерживается; автоматической конвертации нет")
  row.errors = [...new Set(row.errors)]
  if (row.errors.length || row.warnings.length) row.confidence = "review"
  return row
}
