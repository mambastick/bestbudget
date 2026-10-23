export interface DefaultCategory {
  name: string
  icon: string
  color: string
}

export const DEFAULT_INCOME_CATEGORIES: DefaultCategory[] = [
  { name: "Зарплата", icon: "briefcase", color: "#16a34a" },
  { name: "Аванс", icon: "wallet", color: "#22c55e" },
  { name: "Премия", icon: "award", color: "#0d9488" },
  { name: "Подработка", icon: "laptop", color: "#0891b2" },
  { name: "Инвестиции", icon: "trending-up", color: "#2563eb" },
  { name: "Подарки", icon: "gift", color: "#db2777" },
  { name: "Возвраты", icon: "undo", color: "#7c3aed" },
  { name: "Прочие доходы", icon: "plus-circle", color: "#64748b" },
]

export const DEFAULT_EXPENSE_CATEGORIES: DefaultCategory[] = [
  { name: "Продукты", icon: "shopping-cart", color: "#16a34a" },
  { name: "Рестораны и доставка", icon: "utensils", color: "#ea580c" },
  { name: "ЖКХ", icon: "zap", color: "#ca8a04" },
  { name: "Аренда", icon: "key", color: "#9333ea" },
  { name: "Ипотека", icon: "home", color: "#7c3aed" },
  { name: "Проценты по кредитам", icon: "landmark", color: "#dc2626" },
  { name: "Кредиты", icon: "landmark", color: "#dc2626" },
  { name: "Подписки", icon: "repeat", color: "#0891b2" },
  { name: "Транспорт", icon: "bus", color: "#2563eb" },
  { name: "Автомобиль", icon: "car", color: "#475569" },
  { name: "Здоровье", icon: "heart-pulse", color: "#e11d48" },
  { name: "Одежда", icon: "shirt", color: "#c026d3" },
  { name: "Развлечения", icon: "party-popper", color: "#f59e0b" },
  { name: "Образование", icon: "graduation-cap", color: "#0d9488" },
  { name: "Путешествия", icon: "plane", color: "#0284c7" },
  { name: "Семья", icon: "users", color: "#db2777" },
  { name: "Прочее", icon: "circle", color: "#64748b" },
]

export const DEFAULT_ACCOUNT_NAME = "Основной счёт"

export const ACCOUNT_KIND_LABELS = {
  cash: "Наличные",
  debit_card: "Банковская карта",
  credit_card: "Кредитная карта",
  savings: "Накопительный счёт",
  shared: "Общий счёт",
  other: "Другое",
  loan: "Кредит",
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
