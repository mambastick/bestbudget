import type { IsoDate } from "@/lib/dates"

export type OperationType = "income" | "expense" | "transfer"

/** The editable shape of a transaction as sent to client components. */
export interface OperationRow {
  loanId?: string | null
  loanPrincipal?: number
  loanInterest?: number
  loanPart?: "principal" | "interest" | "prepayment" | null
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

export const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const
