import { createTranslator } from "use-intl/core"
import ru from "../../messages/ru/recurring.json"
import en from "../../messages/en/recurring.json"
import { addDays, daysInMonth, diffDays, makeDate, maxDate, minDate, ymd, type IsoDate } from "@/lib/dates"

export type Frequency = "once" | "daily" | "weekly" | "monthly" | "yearly"

export interface Schedule {
  frequency: Frequency
  interval: number
  /** Day of month for monthly/yearly; defaults to the start date's day. */
  dayOfMonth: number | null
  startDate: IsoDate
  endDate: IsoDate | null
}

/** Guard against pathological ranges (e.g. a daily rule over centuries). */
const MAX_OCCURRENCES = 5000

function monthIndex(date: IsoDate): number {
  const { y, m } = ymd(date)
  return y * 12 + (m - 1)
}

function dateInMonth(index: number, day: number): IsoDate {
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return makeDate(y, m, Math.min(day, daysInMonth(y, m)))
}

/**
 * All occurrence dates of a schedule within [from, to] (inclusive), in ascending order.
 *
 * Monthly/yearly rules on days that do not exist in a month (29–31, Feb 29) fall on the
 * last day of that month, and return to the configured day in longer months — there is no drift.
 */
export function occurrencesBetween(s: Schedule, from: IsoDate, to: IsoDate): IsoDate[] {
  const lo = maxDate(from, s.startDate)
  const hi = s.endDate ? minDate(to, s.endDate) : to
  if (lo > hi) return []
  const interval = Math.max(1, Math.floor(s.interval))
  const out: IsoDate[] = []

  switch (s.frequency) {
    case "once":
      if (s.startDate >= lo && s.startDate <= hi) out.push(s.startDate)
      break

    case "daily":
    case "weekly": {
      const step = s.frequency === "daily" ? interval : interval * 7
      const k0 = Math.ceil(diffDays(lo, s.startDate) / step)
      for (let d = addDays(s.startDate, k0 * step); d <= hi && out.length < MAX_OCCURRENCES; d = addDays(d, step)) {
        out.push(d)
      }
      break
    }

    case "monthly":
    case "yearly": {
      const step = s.frequency === "monthly" ? interval : interval * 12
      const start = ymd(s.startDate)
      const day = s.dayOfMonth ?? start.d
      const startIdx = monthIndex(s.startDate)
      // First period index whose month is not before `lo`'s month.
      const k0 = Math.max(0, Math.floor((monthIndex(lo) - startIdx) / step))
      for (let k = k0; out.length < MAX_OCCURRENCES; k++) {
        const d = dateInMonth(startIdx + k * step, day)
        if (d > hi) break
        if (d >= lo) out.push(d)
      }
      break
    }
  }
  return out
}

/** Locale is explicit at UI boundaries; the default supports existing service callers. */
export function describeSchedule(s: Pick<Schedule, "frequency" | "interval" | "dayOfMonth" | "startDate">, locale = "ru"): string {
  const t = createTranslator({ locale, messages: locale.startsWith("ru") ? ru : en })
  const count = s.interval
  const day = s.dayOfMonth ?? ymd(s.startDate).d
  switch (s.frequency) {
    case "once":
      return t("scheduleOnce")
    case "daily":
      return t("scheduleDaily", { count })
    case "weekly": {
      const date = new Date(s.startDate + "T00:00:00Z")
      const weekdayKey = (["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const)[date.getUTCDay()]!
      const weekday = locale.startsWith("ru")
        ? t(`weekdays.${weekdayKey}`)
        : new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date)
      return t("scheduleWeekly", { count, weekday })
    }
    case "monthly":
      return t("scheduleMonthly", { count, day })
    case "yearly": {
      // Format the month with the target day without normalizing short-month dates into March.
      const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" })
        .formatToParts(new Date(Date.UTC(2000, Number(s.startDate.slice(5, 7)) - 1, 1)))
        .map((part) => part.type === "day" ? new Intl.NumberFormat(locale).format(day) : part.value).join("")
      return t("scheduleYearly", { count, date })
    }
  }
}
