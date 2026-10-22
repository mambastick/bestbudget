import { currencyExponent } from "./currencies"
import { diffDays, formatDateFull, formatDay } from "./dates"
import { divideRounded, rateUnits, selectRate, type ExchangeRate } from "./exchange-rates"
import { plural } from "./plural"

/** Display rates in the familiar RUB-per-foreign-unit direction; cross-pairs follow the transfer direction. */
export function formatExchangeRate(amount: number, toAmount: number, from: string, to: string): string | null {
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(toAmount) || amount <= 0 || toAmount <= 0 || from === to) return null
  const reverse = from === "RUB"
  const unit = reverse ? to : from
  const price = reverse ? from : to
  const numerator = BigInt(reverse ? amount : toAmount) * 10n ** BigInt(currencyExponent(unit))
  const denominator = BigInt(reverse ? toAmount : amount) * 10n ** BigInt(currencyExponent(price))
  return formatRatio(numerator, denominator, unit, price)
}

function formatRatio(numerator: bigint, denominator: bigint, unit: string, price: string): string {
  const scale = 100_000_000n
  const rounded = divideRounded(numerator * scale, denominator)
  const whole = new Intl.NumberFormat("ru-RU").format(rounded / scale)
  const fraction = String(rounded % scale).padStart(8, "0").replace(/0+$/, "").padEnd(2, "0")
  return `1 ${unit} = ${whole},${fraction} ${price === "RUB" ? "₽" : price}`
}

export function formatQuotedRate(rates: ExchangeRate[], from: string, to: string): string | null {
  if (from === to) return null
  const unit = from === "RUB" ? to : from
  const price = from === "RUB" ? from : to
  const rate = (currency: string) => currency === "RUB" ? "1" : rates.find((r) => r.currency === currency)?.rateToRub
  const numerator = rate(unit)
  const denominator = rate(price)
  return numerator && denominator ? formatRatio(rateUnits(numerator), rateUnits(denominator), unit, price) : null
}

export function formatRateSource(rates: ExchangeRate[]): string | null {
  const foreign = rates.filter((r) => r.currency !== "RUB")
  if (!foreign.length) return null
  const source = (r: ExchangeRate) => `${r.source === "manual" ? "ручной курс" : "курс ЦБ"} на ${formatDay(r.date)}`
  if (foreign.every((r) => r.date === foreign[0]!.date && r.source === foreign[0]!.source)) return source(foreign[0]!)
  return foreign.map((r) => `${r.currency}: ${source(r)}`).join(" · ")
}

export function balanceValuation(rates: ExchangeRate[], foreignCurrencies: string[], base: string, today: string) {
  const used = foreignCurrencies.length
    ? [...new Set([...foreignCurrencies, base])].filter((c) => c !== "RUB").flatMap((c) => selectRate(rates, c, today) ?? [])
    : []
  const oldest = used.map((r) => r.date).sort()[0]
  const count = foreignCurrencies.length
  const note = count ? `Включая ${count} ${plural(count, "валютный счёт", "валютных счёта", "валютных счетов")}${oldest ? ` · оценка на ${formatDateFull(oldest)}` : ""}` : null
  const stale = used.filter((r) => diffDays(today, r.date) > 7).map((r) => `${r.currency}: курс от ${formatDay(r.date)} (${r.source === "manual" ? "ручной" : "ЦБ"})`)
  return { note, stale }
}
