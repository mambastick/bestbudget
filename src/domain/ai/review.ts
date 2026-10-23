import { z } from "zod"
import { addDays, daysInMonth, makeDate, startOfMonth, todayIn, weekday, ymd } from "@/lib/dates"
import { localClock } from "@/domain/notifications"

export const REVIEW_MANUAL_LIMIT = 2
export const reviewSettingsInput = z.object({
  frequency: z.enum(["off", "weekly", "monthly"]).default("off"),
  weekday: z.number().int().min(1).max(7).default(1),
  monthDay: z.number().int().min(1).max(31).default(1),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default("09:00"),
  telegram: z.boolean().default(true),
  push: z.boolean().default(true),
  email: z.boolean().default(true),
  version: z.number().int().nonnegative().default(0),
})
export type ReviewSettings = z.output<typeof reviewSettingsInput>
export const insightInput = z.object({
  type: z.enum(["budget", "category_growth", "recurring", "subscription", "cash_gap", "goal", "loan"]),
  entityId: z.uuid(),
  direction: z.enum(["increase", "decrease", "pause", "adjust", "review"]),
  title: z.string().trim().min(1).max(120),
  explanation: z.string().trim().min(1).max(900),
  importance: z.enum(["low", "medium", "high"]),
  proposalIds: z.array(z.uuid()).max(5),
})
export const reviewOutput = z.object({ insights: z.array(insightInput).max(10) })
export type ReviewOutput = z.output<typeof reviewOutput>

/** Catch up once in the current local period; DST repetitions share the same key. */
export function dueReview(settings: ReviewSettings, timezone: string, now: Date) {
  if (settings.frequency === "off") return null
  const today = todayIn(timezone, now)
  const { y, m } = ymd(today)
  const period = settings.frequency === "weekly" ? addDays(today, 1 - weekday(today)) : startOfMonth(today)
  const date =
    settings.frequency === "weekly"
      ? addDays(period, settings.weekday - 1)
      : makeDate(y, m, Math.min(settings.monthDay, daysInMonth(y, m)))
  if (today < date || (today === date && localClock(timezone, now, "en") < settings.time)) return null
  return `${settings.frequency}:${period}`
}
