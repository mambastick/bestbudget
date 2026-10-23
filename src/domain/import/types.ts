import bankData from "./bank-data.json"
import { importMessage } from "./messages"
import { z } from "zod"

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_ROWS = 50_000
export const MAX_COLUMNS = 100
export const PROFILE_VERSION = 1

export const PENDING_ROW_MESSAGE = importMessage("pending")
export const REJECTED_ROW_MESSAGE = importMessage("rejected")

export const columnFields = [
  "account",
  "date",
  "bookingDate",
  "amount",
  "income",
  "expense",
  "direction",
  "description",
  "currency",
  "mcc",
  "bankCategory",
  "status",
  "externalId",
  "originalAmount",
  "originalCurrency",
  "balance",
  "card",
  "toAccount",
  "toAmount",
  "toCurrency",
  "type",
  "title",
  "kindHint",
  "counterparty",
  "cashback",
  "bonuses",
] as const
export type ColumnField = (typeof columnFields)[number]

export const mappingSchema = z
  .object({
    columns: z.partialRecord(
      z.enum(columnFields),
      z
        .number()
        .int()
        .min(0)
        .max(MAX_COLUMNS - 1),
    ),
    amountMode: z.enum(["signed", "separate", "direction"]).default("signed"),
    dateFormat: z.enum(["iso", "dmy", "mdy"]).default("iso"),
    decimal: z.enum([".", ","]).default("."),
    currency: z.string().max(3).default("RUB"),
    incomeValue: z.string().trim().min(1).max(60).default(bankData.markers.income),
    expenseValue: z.string().trim().min(1).max(60).default(bankData.markers.expense),
    assumePosted: z.boolean().default(false),
  })
  .refine((m) => m.amountMode !== "direction" || m.incomeValue.toLowerCase() !== m.expenseValue.toLowerCase(), importMessage("directions"))
export type ColumnMapping = z.output<typeof mappingSchema>

export const fileOptionsSchema = z.object({
  encoding: z.enum(["auto", "utf-8", "windows-1251", "utf-16le", "utf-16be"]).default("auto"),
  delimiter: z.enum(["auto", ";", ",", "\t"]).default("auto"),
  sheet: z.number().int().min(0).max(99).default(0),
  headerRow: z.number().int().min(1).max(1000).default(1),
})
export type FileOptions = z.output<typeof fileOptionsSchema>

export const previewInputSchema = z.object({
  file: fileOptionsSchema,
  profile: z.string().max(100),
  mapping: mappingSchema,
  accounts: z.record(z.string().max(200), z.uuid()),
  defaultAccountId: z.uuid().optional(),
  saveProfileName: z.string().trim().max(60).optional(),
  plannedDays: z.number().int().min(0).max(14).default(3),
  plannedTolerance: z.number().int().min(0).max(1_000_000_00).default(0),
})
export type PreviewInput = z.output<typeof previewInputSchema>

export interface IncomingRow {
  rowLocator: string
  accountHint: string | null
  externalId: string | null
  operationAtRaw: string | null
  bookingDateRaw: string | null
  effectiveDate: string | null
  amountMinorSigned: number | null
  currency: string
  originalAmountMinorSigned: number | null
  originalCurrency: string | null
  status: "posted" | "pending" | "rejected" | "unknown"
  exportStatus: "posted" | "planned" | "skipped" | null
  descriptionRaw: string
  descriptionNormalized: string
  mcc: string | null
  bankCategory: string | null
  cardHint: string | null
  counterpartyHint: string | null
  balanceAfterMinor: number | null
  confidence: "high" | "review"
  warnings: string[]
  errors: string[]
  toAccountHint: string | null
  toAmount: number | null
  toCurrency: string | null
  typeHint: string | null
  kindHint: string | null
  bankMetadata: Record<string, string>
  title: string | null
}

export interface Candidate {
  kind: "duplicate" | "manual" | "planned" | "transfer"
  transactionId?: string
  transactionType?: "income" | "expense" | "transfer"
  categoryId?: string | null
  version?: number
  rowIndex?: number
  label: string
}
export interface RowProposal {
  candidates: Candidate[]
  categorySource: string | null
}
export const decisionSchema = z.object({
  rowId: z.uuid(),
  decision: z.enum(["create", "skip", "confirm", "transfer", "link"]),
  candidateIndex: z.number().int().min(0).max(100).optional(),
  categoryId: z.uuid().nullable().optional(),
  remember: z.boolean().optional(),
  allowDuplicate: z.boolean().optional(),
})
export type RowDecision = z.output<typeof decisionSchema>

export function canImportRow(row: IncomingRow): boolean {
  return !row.errors.length && (row.status === "posted" || row.exportStatus === "planned" || row.exportStatus === "skipped")
}
