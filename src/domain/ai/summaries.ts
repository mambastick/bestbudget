import { createTranslator } from "use-intl/core"
import ru from "../../../messages/ru/ai.json"
import en from "../../../messages/en/ai.json"
import { describeSchedule, type Frequency } from "@/domain/recurrence"
import { formatDateFull, isIsoDate } from "@/lib/dates"
import { formatMoney } from "@/lib/money"
import { proposalCurrency, proposalIsCreation } from "./description"
import type { ProposalItem } from "./types"

export interface ProposalSummary {
  primary: string
  secondary?: string
}
interface SummaryContext {
  item: ProposalItem
  t(key: keyof typeof ru.summaries, values?: Record<string, string | number>): string
  text(field: string, fallback?: string): string
  money(field: string): string
  account(field: string): string
  date(field: string): string
  schedule(): string
  period(): string
}
type SummaryRenderer = (context: SummaryContext) => ProposalSummary
const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ") || undefined

const recurring: SummaryRenderer = ({ item, t, text, money, account, schedule, period }) => ({
  primary: t("recurring_create", {
    type: text("type"),
    name: text("title", item.label),
    amount: money("amount"),
    schedule: schedule(),
    account: account("accountId"),
  }),
  secondary: join(
    text("type") === "transfer" ? t("transfer_destination", { amount: money("toAmount"), account: account("toAccountId") }) : undefined,
    period(),
  ),
})
const goal: SummaryRenderer = ({ item, t, text, money, account, date }) => ({
  primary: t("goal_create", {
    name: text("name", item.label),
    amount: money("targetAmount"),
    kind: text("kind"),
    account: account("accountId"),
  }),
  secondary: join(
    date("targetDate") ? t("goal_deadline", { date: date("targetDate") }) : undefined,
    typeof item.after.allocatedAmount === "number" ? t("goal_allocation", { amount: money("allocatedAmount") }) : undefined,
    typeof item.after.priority === "number" && item.after.priority !== 100
      ? t("goal_priority", { priority: item.after.priority })
      : undefined,
    typeof item.after.expenseMonths === "number" ? t("goal_emergency", { months: item.after.expenseMonths }) : undefined,
  ),
})
const renderers: Record<string, SummaryRenderer> = {
  "budget.set": ({ item, t, money }) => ({ primary: t("budget_set", { name: item.label, amount: money("amount") }) }),
  "budget.planned": ({ t, text, money }) => ({ primary: t("budget_planned", { name: text("categoryName"), amount: money("amount") }) }),
  "category.create": ({ item, t, text }) => ({ primary: t("category_create", { name: text("name", item.label) }) }),
  "account.create": ({ item, t, text, money }) => ({
    primary: t("account_create", { name: text("name", item.label), amount: money("openingBalance") }),
    secondary:
      typeof item.after.creditLimit === "number" && item.after.creditLimit > 0
        ? t("account_limit", { amount: money("creditLimit") })
        : undefined,
  }),
  "recurring.create": recurring,
  "recurring.planned": recurring,
  "goal.create": goal,
  "goal.create_automated": (context) => {
    const summary = goal(context)
    return {
      ...summary,
      secondary: join(
        summary.secondary,
        context.t("goal_automation", {
          amount: context.money("topupAmount"),
          schedule: context.schedule(),
          account: context.account("sourceAccountId"),
        }),
        context.item.toCurrency && context.item.toCurrency !== proposalCurrency(context.item, "topupAmount")
          ? context.t("transfer_destination", { amount: context.money("toAmount"), account: context.account("toAccountId") })
          : undefined,
        context.period(),
      ),
    }
  },
  "goal.automate": ({ item, t, money, account, schedule, period }) => ({
    primary: t("goal_automate", { name: item.label, amount: money("amount"), schedule: schedule(), account: account("accountId") }),
    secondary: join(
      item.toCurrency && item.toCurrency !== item.currency
        ? t("transfer_destination", { amount: money("toAmount"), account: account("toAccountId") })
        : undefined,
      period(),
    ),
  }),
  "import.rule": ({ item, t, text, money }) => ({
    primary: t("import_rule", { category: item.label }),
    secondary: join(
      text("descriptionPattern") ? t("import_pattern", { mode: text("descriptionMode"), pattern: text("descriptionPattern") }) : undefined,
      text("mcc") ? t("import_mcc", { mcc: text("mcc") }) : undefined,
      text("currency") && text("currency") !== item.householdCurrency ? t("import_currency", { currency: text("currency") }) : undefined,
      typeof item.after.minAmount === "number" ? t("minimum", { amount: money("minAmount") }) : undefined,
      typeof item.after.maxAmount === "number" ? t("maximum", { amount: money("maxAmount") }) : undefined,
    ),
  }),
}

/** Each creation type owns its human summary; updates retain the separate before/after renderer. */
export function proposalSummary(item: ProposalItem, names: Record<string, string>, locale = "ru"): ProposalSummary | null {
  if (!proposalIsCreation(item)) return null
  const language = locale.startsWith("ru") ? "ru" : "en"
  const translator = createTranslator({ locale: language, messages: language === "ru" ? ru : en })
  const t: SummaryContext["t"] = (key, values) => translator(`summaries.${key}`, values)
  const text = (field: string, fallback = "") => {
    const value = item.after[field]
    return typeof value === "string" ? (names[value] ?? value) : fallback
  }
  const account = (field: string) => {
    const id = item.after[field]
    if (typeof id !== "string") return t("unknown_account")
    if (names[id]) return names[id]
    const references = item.before?.references
    const accounts = references && typeof references === "object" && "accounts" in references ? references.accounts : []
    const found = Array.isArray(accounts)
      ? (accounts.find((value: unknown) => value && typeof value === "object" && "id" in value && value.id === id) as
          | Record<string, unknown>
          | undefined)
      : undefined
    return typeof found?.name === "string" ? found.name : t("unknown_account")
  }
  const money = (field: string) => {
    const amount = item.after[field] ?? (field === "toAmount" ? item.after.amount : undefined)
    if (typeof amount !== "number") return translator("none")
    if (item.type === "import.rule" && !item.after.currency)
      return translator("minorUnits", { value: new Intl.NumberFormat(language).format(amount) })
    const currency = proposalCurrency(item, field)
    const formatted = formatMoney(amount, currency, { locale: language })
    return currency === item.householdCurrency ? formatted : t("foreign_amount", { amount: formatted, currency })
  }
  const date = (field: string) => {
    const value = item.after[field]
    return typeof value === "string" && isIsoDate(value) ? formatDateFull(value, language) : ""
  }
  const schedule = () => {
    const frequency = text("frequency", "monthly")
    const day =
      typeof item.after.dayOfMonth === "number"
        ? item.after.dayOfMonth
        : typeof item.after.day === "number"
          ? item.after.day
          : Number(text("startDate").slice(8, 10))
    const interval = typeof item.after.interval === "number" ? item.after.interval : 1
    if (frequency === "monthly" && interval === 1 && Number.isInteger(day) && day >= 1 && day <= 31) return t("monthly_day", { day })
    if (frequency === "once") return t("once_date", { date: date("startDate") })
    if (!["daily", "weekly", "monthly", "yearly"].includes(frequency) || !isIsoDate(text("startDate"))) return ""
    return describeSchedule(
      { frequency: frequency as Frequency, interval, dayOfMonth: Number.isInteger(day) ? day : null, startDate: text("startDate") },
      language,
    )
  }
  const period = () =>
    date("startDate") ? t("period", { from: date("startDate"), to: date("endDate"), end: date("endDate") ? "yes" : "no" }) : ""
  const context: SummaryContext = { item, t, text, money, account, date, schedule, period }
  return renderers[item.type]?.(context) ?? { primary: t("unknown", { name: item.label }) }
}
