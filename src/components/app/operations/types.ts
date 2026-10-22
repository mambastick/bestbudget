import type { IsoDate } from "@/lib/dates"

export type OperationType = "income" | "expense" | "transfer"

/** The editable shape of a transaction as sent to client components. */
export interface OperationRow {
  id: string
  type: OperationType
  status: "planned" | "posted" | "skipped"
  amount: number
  toAmount: number | null
  title: string
  description: string | null
  date: IsoDate
  occurrenceDate: IsoDate | null
  categoryId: string | null
  accountId: string
  toAccountId: string | null
  recurringRuleId: string | null
  version: number
}

export interface RuleRow {
  id: string
  type: OperationType
  title: string
  description: string | null
  amount: number
  toAmount: number | null
  categoryId: string | null
  accountId: string
  toAccountId: string | null
  frequency: "once" | "daily" | "weekly" | "monthly" | "yearly"
  interval: number
  dayOfMonth: number | null
  startDate: IsoDate
  endDate: IsoDate | null
  version: number
}

export const TYPE_LABELS: Record<OperationType, string> = {
  expense: "Расход",
  income: "Доход",
  transfer: "Перевод",
}

export const STATUS_LABELS = {
  planned: "Запланирована",
  posted: "Выполнена",
  skipped: "Пропущена",
} as const

export const FREQUENCY_LABELS = {
  daily: "Ежедневно",
  weekly: "Еженедельно",
  monthly: "Ежемесячно",
  yearly: "Ежегодно",
} as const
