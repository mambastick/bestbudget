import { mappingSchema, type ColumnMapping } from "./types"

export const PROFILES = [
  { id: "bestbudget-v1", name: "BestBudget CSV v1", experimental: false },
  { id: "bestbudget-export", name: "Экспорт BestBudget", experimental: false },
  { id: "tbank-csv-legacy-candidate", name: "Т-Банк CSV — экспериментальный, проверьте предпросмотр", experimental: true },
  { id: "custom", name: "Мастер колонок (в том числе Альфа / Сбер)", experimental: false },
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
const exported = {
  date: "Дата",
  type: "Тип",
  status: "Статус",
  title: "Название",
  bankCategory: "Категория",
  account: "Счёт",
  toAccount: "Счёт зачисления",
  amount: "Сумма",
  currency: "Валюта",
  toAmount: "Зачислено",
  toCurrency: "Валюта зачисления",
  description: "Описание",
  externalId: "ID операции",
} as const
const tbank = {
  date: "Дата операции",
  bookingDate: "Дата платежа",
  card: "Номер карты",
  status: "Статус",
  amount: "Сумма платежа",
  currency: "Валюта платежа",
  originalAmount: "Сумма операции",
  originalCurrency: "Валюта операции",
  bankCategory: "Категория",
  mcc: "MCC",
  description: "Описание",
  cashback: "Кэшбэк",
  bonuses: "Бонусы (включая кэшбэк)",
} as const

export function profileMapping(id: string, headers: string[]): ColumnMapping {
  const aliases: Partial<Record<keyof ColumnMapping["columns"], string>> =
    id === "bestbudget-v1" ? universal : id === "bestbudget-export" ? exported : id === "tbank-csv-legacy-candidate" ? tbank : {}
  const columns: ColumnMapping["columns"] = {}
  for (const [field, alias] of Object.entries(aliases)) {
    const matches = headers.map((h, i) => (normalizeHeader(h) === normalizeHeader(alias) ? i : -1)).filter((i) => i >= 0)
    if (matches.length > 1) throw new Error(`Повторяющийся заголовок: ${alias}`)
    if (matches[0] !== undefined) columns[field as keyof typeof columns] = matches[0]
  }
  return mappingSchema.parse({
    columns,
    dateFormat: id.startsWith("tbank") ? "dmy" : "iso",
    decimal: id === "bestbudget-v1" ? "." : ",",
    assumePosted: id === "bestbudget-v1",
  })
}

export function detectProfile(headers: string[]): string {
  const has = (names: string[]) => names.every((name) => headers.some((h) => normalizeHeader(h) === normalizeHeader(name)))
  if (has(["account", "date", "amount", "currency", "description"])) return "bestbudget-v1"
  if (has(Object.values(exported).filter((name) => name !== "ID операции"))) return "bestbudget-export"
  if (has(Object.values(tbank).filter((name) => !["Кэшбэк", "Бонусы (включая кэшбэк)"].includes(name)))) return "tbank-csv-legacy-candidate"
  return "custom"
}
