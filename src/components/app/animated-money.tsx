"use client"

import { useLocale } from "next-intl"
import CountUp from "@/components/reactbits/CountUp"
import { currencyExponent } from "@/lib/currencies"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

/**
 * An amount that counts up to its value (React Bits CountUp), e.g. the balance on the dashboard.
 * Screen readers and the initial render get the final formatted value.
 */
export function AnimatedMoney({
  value,
  currency = "RUB",
  tone = "neutral",
  className,
}: {
  value: number
  currency?: string
  tone?: "neutral" | "income" | "expense" | "auto"
  className?: string
}) {
  const locale = useLocale()
  const resolved = tone === "auto" ? (value > 0 ? "income" : value < 0 ? "expense" : "neutral") : tone
  const exponent = currencyExponent(currency)
  const scale = 10 ** exponent
  const parts = new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(1234.5)
  const firstNumber = parts.findIndex((part) => part.type === "integer")
  const lastNumber = parts.findLastIndex((part) => part.type === "integer" || part.type === "fraction")
  const prefix = parts.slice(0, firstNumber).map((part) => part.value).join("")
  const suffix = parts.slice(lastNumber + 1).map((part) => part.value).join("")
  return (
    <span
      className={cn("tabular whitespace-nowrap", resolved === "income" && "text-income", resolved === "expense" && "text-expense", className)}
      aria-label={formatMoney(value, currency, { locale })}
    >
      <span aria-hidden>
        <CountUp
          key={`${locale}:${value}`}
          to={Math.abs(value) / scale}
          decimals={value % scale === 0 ? 0 : exponent}
          separator={parts.find((part) => part.type === "group")?.value ?? ""}
          decimalSeparator={parts.find((part) => part.type === "decimal")?.value ?? "."}
          prefix={`${value < 0 ? "\u2212" : ""}${prefix}`}
          suffix={suffix}
          duration={0.9}
          trigger="load"
        />
      </span>
    </span>
  )
}
