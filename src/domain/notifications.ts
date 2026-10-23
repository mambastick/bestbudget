import { notificationTranslator } from "@/i18n/notifications"
import type { Locale } from "@/i18n/locale"
import { z } from "zod"
import { addDays, diffDays, formatDay, monthKey, todayIn } from "@/lib/dates"
import { formatMoney } from "@/lib/money"

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "validation.time")
export const preferencesInput = z.object({
  aiReview: z.boolean().default(true),
  reviewEmail: z.boolean().default(false),
  telegram: z.boolean().default(false),
  push: z.boolean().default(false),
  due: z.boolean().default(true),
  overdue: z.boolean().default(true),
  cashGap: z.boolean().default(true),
  budget: z.boolean().default(true),
  daysBefore: z.number().int().min(0).max(30).default(1),
  budgetThreshold: z.number().int().min(0).max(500).default(15),
  digest: z.boolean().default(false),
  digestTime: time.default("09:00"),
  quietStart: time.default("22:00"),
  quietEnd: time.default("08:00"),
  version: z.number().int().nonnegative().default(0),
})
export type Preferences = z.output<typeof preferencesInput>
export type Notice = {
  kind: string
  key: string
  text: string
  path: string
  payment?: { id: string; version: number }
  budgetKeys?: string[]
}
export interface NoticeSnapshot {
  name?: string
  householdId: string
  currency: string
  payments: {
    id: string
    version: number
    date: string
    type: string
    status: string
    title: string
    amount: number
    currency: string
    accountName: string
  }[]
  forecast: { date: string; balance: number }[]
  budgets: { id: string; name: string; limit: number | null; spent: number }[]
}

export function localClock(timeZone: string, now: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { timeZone, numberingSystem: "latn", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    now,
  )
}

export function isQuiet(clock: string, start: string, end: string): boolean {
  if (start === end) return false
  return start < end ? clock >= start && clock < end : clock >= start || clock < end
}

export function noticesFor(s: NoticeSnapshot, p: Preferences, today: string, locale: Locale): Notice[] {
  const translate = notificationTranslator(locale)
  const notices: Notice[] = []
  for (const t of s.payments) {
    if (t.status !== "planned" || t.type === "income") continue
    const amount = formatMoney(t.amount, t.currency, { locale })
    if (t.date < today && p.overdue) {
      notices.push({
        kind: "overdue",
        key: `overdue:${t.id}:${t.date}`,
        text: translate("overdue", { title: t.title, amount, count: diffDays(today, t.date) }),
        path: "/transactions",
        payment: { id: t.id, version: t.version },
      })
    } else if (p.due && t.date >= today && t.date <= addDays(today, p.daysBefore)) {
      const when = t.date === today ? translate("today") : t.date === addDays(today, 1) ? translate("tomorrow") : formatDay(t.date, locale)
      notices.push({
        kind: "due",
        key: `due:${t.id}:${t.date}`,
        text: translate("due", { when, title: t.title, amount, account: t.accountName }),
        path: "/transactions",
        payment: { id: t.id, version: t.version },
      })
    }
  }
  const gap = s.forecast.find((d) => d.date >= today && d.balance < 0)
  if (p.cashGap && gap)
    notices.push({
      kind: "cash_gap",
      key: `gap:${s.householdId}:${gap.date}`,
      text: translate("cashGap", { date: formatDay(gap.date, locale), amount: formatMoney(gap.balance, s.currency, { locale }) }),
      path: "/calendar",
    })
  if (p.budget)
    for (const b of s.budgets) {
      if (!b.limit || BigInt(b.spent) * 100n < BigInt(b.limit) * BigInt(100 + p.budgetThreshold)) continue
      if (b.spent <= b.limit) continue
      const excess = Number((BigInt(b.spent - b.limit) * 100n) / BigInt(b.limit))
      notices.push({
        kind: "budget",
        key: `budget:${s.householdId}:${b.id}:${monthKey(today)}:${p.budgetThreshold}`,
        text: translate("budget", { name: b.name, percent: excess }),
        path: "/budgets",
      })
    }
  return notices
}

/** Recomputed until quiet hours end; digest catches up after downtime within the local day. */
export function scheduledNotices(
  s: NoticeSnapshot,
  p: Preferences,
  timezone: string,
  now: Date,
  locale: Locale,
  suppressedBudgets: ReadonlySet<string> = new Set(),
): Notice[] {
  const translate = notificationTranslator(locale)
  const clock = localClock(timezone, now, locale)
  if (isQuiet(clock, p.quietStart, p.quietEnd)) return []
  const today = todayIn(timezone, now)
  const items = noticesFor(s, p, today, locale).filter((n) => n.kind !== "budget" || !suppressedBudgets.has(n.key))
  if (!p.digest) return items
  if (clock < p.digestTime) return []
  return [
    {
      kind: "digest",
      key: `digest:${s.householdId}:${today}`,
      text: translate("digest", { date: formatDay(today, locale), items: items.length ? items.map((n) => n.text).join("\n") : translate("noNotices") }),
      path: "/dashboard",
      budgetKeys: items.filter((n) => n.kind === "budget").map((n) => n.key),
    },
  ]
}

/** Leave space for household name and links; never split surrogate pairs. */
export function truncateMessage(text: string, max = 3500, locale: Locale = "en"): string {
  if (text.length <= max) return text
  return (
    Array.from(text.slice(0, max - 80))
      .join("")
      .replace(/[\uD800-\uDBFF]$/, "") + "\n" + notificationTranslator(locale)("truncated")
  )
}

const privateMessage = z.object({
  chat: z.object({ id: z.number().int().safe(), type: z.literal("private") }),
  from: z.object({ id: z.number().int().safe(), is_bot: z.boolean().optional() }),
  text: z.string().max(4096).optional(),
})
export const telegramUpdate = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: privateMessage.optional(),
  callback_query: z
    .object({
      id: z.string().max(200),
      from: z.object({ id: z.number().int().safe() }),
      data: z.string().max(64).optional(),
      message: privateMessage.omit({ from: true }).optional(),
    })
    .optional(),
})
export function parseTelegramUpdate(raw: unknown) {
  const parsed = telegramUpdate.safeParse(raw)
  return parsed.success ? parsed.data : null
}
export function parsePaymentCallback(data: string) {
  const match = /^pay:([0-9a-f-]{36}):([1-9]\d{0,9})$/i.exec(data)
  if (!match || !z.uuid().safeParse(match[1]).success) return null
  return { id: match[1]!, version: Number(match[2]) }
}
