/** Supported ISO 4217 currencies and minor-unit exponents. */
export const CURRENCIES = {
  RUB: 2, USD: 2, EUR: 2, CNY: 2, KZT: 2, BYN: 2, AMD: 2, GEL: 2,
  TRY: 2, AED: 2, UZS: 2, KGS: 2, GBP: 2, CHF: 2, JPY: 0, THB: 2,
  KRW: 0, INR: 2, BRL: 2, CAD: 2, AUD: 2, BHD: 3,
} as const

export type Currency = keyof typeof CURRENCIES
export const CURRENCY_CODES = Object.keys(CURRENCIES) as [Currency, ...Currency[]]

export function currencyExponent(currency: string): number {
  if (!Object.hasOwn(CURRENCIES, currency)) throw new Error(`Unsupported currency: ${currency}`)
  return CURRENCIES[currency as Currency]
}

export function currencySymbol(currency: string, locale = "ru"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")!.value
}
