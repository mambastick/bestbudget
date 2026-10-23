import { currencyExponent, currencySymbol } from "./currencies"
import { diffDays, formatDateFull, formatDay } from "./dates"
import { divideRounded, rateUnits, selectRate, type ExchangeRate } from "./exchange-rates"
import { createTranslator } from "use-intl/core"
import ru from "../../messages/ru/dashboard.json"
import en from "../../messages/en/dashboard.json"

/** Display rates in the familiar RUB-per-foreign-unit direction; cross-pairs follow the transfer direction. */
export function formatExchangeRate(amount: number, toAmount: number, from: string, to: string, locale = "ru"): string | null {
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(toAmount) || amount <= 0 || toAmount <= 0 || from === to) return null
  const reverse = from === "RUB"
  const unit = reverse ? to : from
  const price = reverse ? from : to
  const numerator = BigInt(reverse ? amount : toAmount) * 10n ** BigInt(currencyExponent(unit))
  const denominator = BigInt(reverse ? toAmount : amount) * 10n ** BigInt(currencyExponent(price))
  return formatRatio(numerator, denominator, unit, price, locale)
}

function formatRatio(numerator: bigint, denominator: bigint, unit: string, price: string, locale: string): string {
  const scale = 100_000_000n
  const rounded = divideRounded(numerator * scale, denominator)
  const whole = new Intl.NumberFormat(locale).format(rounded / scale)
  const fraction = String(rounded % scale).padStart(8, "0").replace(/0+$/, "").padEnd(2, "0")
  return `1 ${unit} = ${whole}${locale.startsWith("ru") ? "," : "."}${fraction} ${price === "RUB" ? currencySymbol(price, locale) : price}`
}

export function formatQuotedRate(rates: ExchangeRate[], from: string, to: string, locale = "ru"): string | null {
  if (from === to) return null
  const unit = from === "RUB" ? to : from
  const price = from === "RUB" ? from : to
  const rate = (currency: string) => currency === "RUB" ? "1" : rates.find((r) => r.currency === currency)?.rateToRub
  const numerator = rate(unit)
  const denominator = rate(price)
  return numerator && denominator ? formatRatio(rateUnits(numerator), rateUnits(denominator), unit, price, locale) : null
}

export function formatRateSource(rates: ExchangeRate[], locale = "ru"): string | null {
  const foreign = rates.filter((r) => r.currency !== "RUB")
  if (!foreign.length) return null
  const t = createTranslator({ locale, messages: locale.startsWith("ru") ? ru : en })
  const source = (r: ExchangeRate) => t(r.source === "manual" ? "manualRateOn" : "cbrRateOn", { date: formatDay(r.date, locale) })
  if (foreign.every((r) => r.date === foreign[0]!.date && r.source === foreign[0]!.source)) return source(foreign[0]!)
  return foreign.map((r) => `${r.currency}: ${source(r)}`).join(" · ")
}

export function balanceValuation(rates: ExchangeRate[], foreignCurrencies: string[], base: string, today: string, locale = "ru") {
  const used = foreignCurrencies.length
    ? [...new Set([...foreignCurrencies, base])].filter((c) => c !== "RUB").flatMap((c) => selectRate(rates, c, today) ?? [])
    : []
  const oldest = used.map((r) => r.date).sort()[0]
  const count = foreignCurrencies.length
  const t = createTranslator({ locale, messages: locale.startsWith("ru") ? ru : en })
  const note = count ? t("foreignAccounts", { count, valuation: oldest ? t("valuationOn", { date: formatDateFull(oldest, locale) }) : "" }) : null
  const stale = used.filter((r) => diffDays(today, r.date) > 7).map((r) => t("staleRate", { currency: r.currency, date: formatDay(r.date, locale), source: t(r.source === "manual" ? "manualSource" : "cbrSource") }))
  return { note, stale }
}
