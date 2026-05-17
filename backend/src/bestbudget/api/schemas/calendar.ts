import { z } from "zod"

export const currencyCodeSchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/)

export const decimalMoneySchema = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, "Use a decimal string, for example 1328.44")

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const calendarItemTypeSchema = z.enum([
  "income",
  "expense",
  "transfer",
  "liability_payment",
  "salary",
  "reminder",
])

export const itemStatusSchema = z.enum([
  "planned",
  "completed",
  "overdue",
  "cancelled",
  "variance",
])

export const calendarDayQuerySchema = z.object({
  householdId: z.string().min(1),
  date: isoDateSchema,
})

export const calendarDayItemSchema = z.object({
  id: z.string(),
  type: calendarItemTypeSchema,
  status: itemStatusSchema,
  title: z.string(),
  amount: decimalMoneySchema.nullable(),
  currency: currencyCodeSchema.nullable(),
  sourceId: z.string().nullable(),
})

export const calendarDayResponseSchema = z.object({
  date: isoDateSchema,
  summary: z.object({
    plannedOutflow: decimalMoneySchema,
    actualOutflow: decimalMoneySchema,
    plannedInflow: decimalMoneySchema,
    actualInflow: decimalMoneySchema,
  }),
  items: z.array(calendarDayItemSchema),
})

export type CalendarDayQuery = z.infer<typeof calendarDayQuerySchema>
export type CalendarDayResponse = z.infer<typeof calendarDayResponseSchema>
