import bankData from "./bank-data.json"
import { importMessage } from "./messages"
import enTransactions from "../../../messages/en/transactions.json"
import { mappingSchema, type ColumnMapping } from "./types"

export const PROFILES = [
  { id: "bestbudget-v1", name: "profiles.bestbudget", experimental: false },
  { id: "bestbudget-export", name: "profiles.export", experimental: false },
  { id: "tbank-csv-legacy-candidate", name: "profiles.tbank", experimental: true },
  { id: "custom", name: "profiles.custom", experimental: false },
]
export const normalizeHeader = (s: string) =>
  s
    .replace(/^\ufeff/, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .trim()
    .toLowerCase()

const universal = {
  account: "account",
  date: "date",
  amount: "amount",
  currency: "currency",
  description: "description",
  externalId: "external_id",
  status: "status",
  mcc: "mcc",
  bankCategory: "bank_category",
  balance: "balance_after",
  bookingDate: "booking_date",
  originalAmount: "original_amount",
  originalCurrency: "original_currency",
  kindHint: "kind_hint",
  card: "card_hint",
  counterparty: "counterparty_hint",
} as const
const exported = bankData.exported
const tbank = bankData.tbank
const exportedEn = {
  date: enTransactions.csv.date,
  type: enTransactions.csv.type,
  status: enTransactions.csv.status,
  title: enTransactions.csv.title,
  bankCategory: enTransactions.csv.category,
  account: enTransactions.csv.account,
  toAccount: enTransactions.csv.destinationAccount,
  amount: enTransactions.csv.amount,
  currency: enTransactions.csv.currency,
  toAmount: enTransactions.csv.credited,
  toCurrency: enTransactions.csv.destinationCurrency,
  description: enTransactions.csv.description,
  externalId: enTransactions.csv.transactionId,
} as const
const isEnglishExport = (headers: string[]) =>
  [exportedEn.type, exportedEn.title, exportedEn.toAccount].every((name) => headers.some((h) => normalizeHeader(h) === normalizeHeader(name)))


export function profileMapping(id: string, headers: string[]): ColumnMapping {
  const exportAliases = isEnglishExport(headers) ? exportedEn : exported
  const aliases: Partial<Record<keyof ColumnMapping["columns"], string>> =
    id === "bestbudget-v1" ? universal : id === "bestbudget-export" ? exportAliases : id === "tbank-csv-legacy-candidate" ? tbank : {}
  const columns: ColumnMapping["columns"] = {}
  for (const [field, alias] of Object.entries(aliases)) {
    const matches = headers.map((h, i) => (normalizeHeader(h) === normalizeHeader(alias) ? i : -1)).filter((i) => i >= 0)
    if (matches.length > 1) throw new Error(importMessage("duplicateHeader", { header: alias }))
    if (matches[0] !== undefined) columns[field as keyof typeof columns] = matches[0]
  }
  return mappingSchema.parse({
    columns,
    dateFormat: id.startsWith("tbank") ? "dmy" : "iso",
    decimal: id === "bestbudget-v1" || (id === "bestbudget-export" && isEnglishExport(headers)) ? "." : ",",
    assumePosted: id === "bestbudget-v1",
  })
}

export function detectProfile(headers: string[]): string {
  const has = (names: string[]) => names.every((name) => headers.some((h) => normalizeHeader(h) === normalizeHeader(name)))
  if (isEnglishExport(headers) && has(Object.values(exportedEn).filter((name) => name !== exportedEn.externalId))) return "bestbudget-export"
  if (has(["account", "date", "amount", "currency", "description"])) return "bestbudget-v1"
  if (has(Object.values(exported).filter((name) => name !== exported.externalId))) return "bestbudget-export"
  if (has(Object.values(tbank).filter((name) => ![tbank.cashback, tbank.bonuses].includes(name)))) return "tbank-csv-legacy-candidate"
  return "custom"
}
