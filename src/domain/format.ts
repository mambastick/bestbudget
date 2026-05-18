import { getCurrency } from "./presets"

export function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")

  return `${year}-${month}-${day}`
}

export function formatHumanDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export function formatMoney(value: number, currencyCode: string) {
  const currency = getCurrency(currencyCode)

  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currency.code,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${Math.round(value).toLocaleString("ru-RU")} ${currency.symbol}`
  }
}

export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")

  return initials.toUpperCase() || "BB"
}
