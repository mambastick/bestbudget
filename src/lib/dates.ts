/**
 * Calendar-date helpers working on ISO `YYYY-MM-DD` strings.
 *
 * Financial dates are calendar days in the household's time zone, so they are
 * stored as SQL `date` and never converted through local time. All arithmetic
 * here uses UTC internally, which has no DST transitions.
 */

export type IsoDate = string

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string): boolean {
  if (!ISO_RE.test(value)) return false
  const d = new Date(value + "T00:00:00Z")
  return !Number.isNaN(d.getTime()) && toIso(d) === value
}

function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10)
}

function parse(date: IsoDate): Date {
  return new Date(date + "T00:00:00Z")
}

export function ymd(date: IsoDate): { y: number; m: number; d: number } {
  return { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)), d: Number(date.slice(8, 10)) }
}

export function makeDate(y: number, m: number, d: number): IsoDate {
  return toIso(new Date(Date.UTC(y, m - 1, d)))
}

/** Days in month, `m` is 1-based. */
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = parse(date)
  d.setUTCDate(d.getUTCDate() + days)
  return toIso(d)
}

/** Adds months, clamping the day to the target month's length (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { y, m, d } = ymd(date)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return makeDate(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86_400_000)
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekday(date: IsoDate): number {
  const w = parse(date).getUTCDay()
  return w === 0 ? 7 : w
}

export function startOfMonth(date: IsoDate): IsoDate {
  return date.slice(0, 8) + "01"
}

export function endOfMonth(date: IsoDate): IsoDate {
  const { y, m } = ymd(date)
  return makeDate(y, m, daysInMonth(y, m))
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b
}

/** Today's calendar date in the given IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** `YYYY-MM` month key. */
export function monthKey(date: IsoDate): string {
  return date.slice(0, 7)
}

export function parseMonthKey(key: string | undefined, fallback: IsoDate): IsoDate {
  if (key && /^\d{4}-\d{2}$/.test(key) && isIsoDate(key + "-01")) return key + "-01"
  return startOfMonth(fallback)
}

const monthFmt = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" })
const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" })
const dayShortFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" })
const fullFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
const weekdayFmt = new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "UTC" })

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatMonth(date: IsoDate): string {
  return capitalize(monthFmt.format(parse(date)).replace(/\s*г\.$/, ""))
}

export function formatDay(date: IsoDate): string {
  return dayFmt.format(parse(date))
}

export function formatDayShort(date: IsoDate): string {
  return dayShortFmt.format(parse(date)).replace(".", "")
}

export function formatDateFull(date: IsoDate): string {
  return fullFmt.format(parse(date)).replace(/\s*г\.$/, "")
}

export function formatWeekday(date: IsoDate): string {
  return weekdayFmt.format(parse(date))
}

export function formatDateTime(value: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(typeof value === "string" ? new Date(value) : value)
}
