import ru from "../../messages/ru/onboarding.json"
import en from "../../messages/en/onboarding.json"

export interface DefaultCategory {
  name: string
  icon: string
  color: string
}

const INCOME_CATEGORIES = [
  { key: "salary", icon: "briefcase", color: "#16a34a" },
  { key: "salaryAdvance", icon: "wallet", color: "#22c55e" },
  { key: "bonus", icon: "award", color: "#0d9488" },
  { key: "sideIncome", icon: "laptop", color: "#0891b2" },
  { key: "investments", icon: "trending-up", color: "#2563eb" },
  { key: "gifts", icon: "gift", color: "#db2777" },
  { key: "refunds", icon: "undo", color: "#7c3aed" },
  { key: "otherIncome", icon: "plus-circle", color: "#64748b" },
] as const

const EXPENSE_CATEGORIES = [
  { key: "groceries", icon: "shopping-cart", color: "#16a34a" },
  { key: "dining", icon: "utensils", color: "#ea580c" },
  { key: "utilities", icon: "zap", color: "#ca8a04" },
  { key: "rent", icon: "key", color: "#9333ea" },
  { key: "mortgage", icon: "home", color: "#7c3aed" },
  { key: "loanInterest", icon: "landmark", color: "#dc2626" },
  { key: "loans", icon: "landmark", color: "#dc2626" },
  { key: "subscriptions", icon: "repeat", color: "#0891b2" },
  { key: "transport", icon: "bus", color: "#2563eb" },
  { key: "car", icon: "car", color: "#475569" },
  { key: "health", icon: "heart-pulse", color: "#e11d48" },
  { key: "clothing", icon: "shirt", color: "#c026d3" },
  { key: "entertainment", icon: "party-popper", color: "#f59e0b" },
  { key: "education", icon: "graduation-cap", color: "#0d9488" },
  { key: "travel", icon: "plane", color: "#0284c7" },
  { key: "family", icon: "users", color: "#db2777" },
  { key: "other", icon: "circle", color: "#64748b" },
] as const

export function householdDefaults(locale: string) {
  const messages = locale.startsWith("ru") ? ru.defaults : en.defaults
  return {
    income: INCOME_CATEGORIES.map(({ key, ...c }) => ({ ...c, name: messages.income[key] })),
    expense: EXPENSE_CATEGORIES.map(({ key, ...c }) => ({ ...c, name: messages.expense[key] })),
    accountName: messages.account,
  }
}

export const ACCOUNT_KIND_LABELS = {
  cash: "kind.cash",
  debit_card: "kind.debit_card",
  credit_card: "kind.credit_card",
  savings: "kind.savings",
  shared: "kind.shared",
  other: "kind.other",
  loan: "kind.loan",
} as const

export const CATEGORY_COLORS = [
  "#16a34a",
  "#0d9488",
  "#0891b2",
  "#0284c7",
  "#2563eb",
  "#7c3aed",
  "#9333ea",
  "#c026d3",
  "#db2777",
  "#e11d48",
  "#dc2626",
  "#ea580c",
  "#f59e0b",
  "#ca8a04",
  "#475569",
  "#64748b",
]
