import type { Category } from "./types"

export type CurrencyOption = {
  code: string
  symbol: string
  region: string
  name: string
}

export type CategoryPreset = {
  name: string
  kind: Category["kind"]
  icon: string
  color: string
}

export const currencyOptions: CurrencyOption[] = [
  { code: "RUB", symbol: "₽", region: "🇷🇺", name: "Российский рубль" },
  { code: "USD", symbol: "$", region: "🇺🇸", name: "Доллар США" },
  { code: "EUR", symbol: "€", region: "🇪🇺", name: "Евро" },
  { code: "AED", symbol: "د.إ", region: "🇦🇪", name: "Дирхам ОАЭ" },
  { code: "UAH", symbol: "₴", region: "🇺🇦", name: "Украинская гривна" },
  { code: "KZT", symbol: "₸", region: "🇰🇿", name: "Казахстанский тенге" },
  { code: "GEL", symbol: "₾", region: "🇬🇪", name: "Грузинский лари" },
  { code: "AMD", symbol: "֏", region: "🇦🇲", name: "Армянский драм" },
  { code: "TRY", symbol: "₺", region: "🇹🇷", name: "Турецкая лира" },
]

export const categoryPresets: CategoryPreset[] = [
  { name: "Доход", kind: "income", icon: "💼", color: "blue" },
  { name: "Еда", kind: "expense", icon: "🍽️", color: "orange" },
  { name: "ЖКХ", kind: "expense", icon: "🏠", color: "cyan" },
  { name: "Транспорт", kind: "expense", icon: "🚕", color: "slate" },
  { name: "Развлечения", kind: "expense", icon: "🎮", color: "violet" },
  { name: "Здоровье", kind: "expense", icon: "⚕️", color: "red" },
  { name: "Связь", kind: "expense", icon: "📱", color: "indigo" },
  { name: "Подписки", kind: "expense", icon: "🔁", color: "purple" },
  { name: "Образование", kind: "expense", icon: "🎓", color: "teal" },
  { name: "Дом", kind: "expense", icon: "🛋️", color: "green" },
  { name: "Кредиты", kind: "expense", icon: "🏦", color: "rose" },
  { name: "Накопления", kind: "neutral", icon: "🐖", color: "emerald" },
]

export function getCurrency(code: string) {
  return (
    currencyOptions.find((currency) => currency.code === code) ??
    currencyOptions[0]
  )
}
