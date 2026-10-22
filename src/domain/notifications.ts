import { z } from "zod"
import { addDays, diffDays, formatDay, monthKey, todayIn } from "@/lib/dates"
import { formatMoney } from "@/lib/money"

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Укажите время ЧЧ:ММ")
export const preferencesInput = z.object({
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
    accountName: string
  }[]
  forecast: { date: string; balance: number }[]
  budgets: { id: string; name: string; limit: number | null; spent: number }[]
}

export function localClock(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    now,
  )
}

export function isQuiet(clock: string, start: string, end: string): boolean {
  if (start === end) return false
  return start < end ? clock >= start && clock < end : clock >= start || clock < end
}

export function noticesFor(s: NoticeSnapshot, p: Preferences, today: string): Notice[] {
  const notices: Notice[] = []
  for (const t of s.payments) {
    if (t.status !== "planned" || t.type === "income") continue
    const amount = formatMoney(t.amount, s.currency)
    if (t.date < today && p.overdue) {
      notices.push({
        kind: "overdue",
        key: `overdue:${t.id}:${t.date}`,
        text: `Просрочено: ${t.title} ${amount} — не подтверждена ${diffDays(today, t.date)} дн.`,
        path: "/transactions",
        payment: { id: t.id, version: t.version },
      })
    } else if (p.due && t.date >= today && t.date <= addDays(today, p.daysBefore)) {
      const when = t.date === today ? "Сегодня" : t.date === addDays(today, 1) ? "Завтра" : formatDay(t.date)
      notices.push({
        kind: "due",
        key: `due:${t.id}:${t.date}`,
        text: `${when} платёж: ${t.title} — ${amount} со счёта ${t.accountName}`,
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
      text: `Кассовый разрыв: ${formatDay(gap.date)} баланс уйдёт в ${formatMoney(gap.balance, s.currency)}`,
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
        text: `Бюджет „${b.name}“ превышен на ${excess}%`,
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
  suppressedBudgets: ReadonlySet<string> = new Set(),
): Notice[] {
  const clock = localClock(timezone, now)
  if (isQuiet(clock, p.quietStart, p.quietEnd)) return []
  const today = todayIn(timezone, now)
  const items = noticesFor(s, p, today).filter((n) => n.kind !== "budget" || !suppressedBudgets.has(n.key))
  if (!p.digest) return items
  if (clock < p.digestTime) return []
  return [
    {
      kind: "digest",
      key: `digest:${s.householdId}:${today}`,
      text: `Сводка за ${formatDay(today)}\n${items.length ? items.map((n) => n.text).join("\n") : "Нет ближайших платежей и предупреждений."}`,
      path: "/dashboard",
      budgetKeys: items.filter((n) => n.kind === "budget").map((n) => n.key),
    },
  ]
}

/** Leave space for household name and links; never split surrogate pairs. */
export function truncateMessage(text: string, max = 3500): string {
  if (text.length <= max) return text
  return (
    Array.from(text.slice(0, max - 80))
      .join("")
      .replace(/[\uD800-\uDBFF]$/, "") + "\n…Остальное — в приложении."
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
