"use client"

import CountUp from "@/components/reactbits/CountUp"
import { currencyExponent, currencySymbol } from "@/lib/currencies"
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
  const resolved = tone === "auto" ? (value > 0 ? "income" : value < 0 ? "expense" : "neutral") : tone
  const symbol = currencySymbol(currency)
  const exponent = currencyExponent(currency)
  const scale = 10 ** exponent
  return (
    <span
      className={cn("tabular whitespace-nowrap", resolved === "income" && "text-income", resolved === "expense" && "text-expense", className)}
      aria-label={formatMoney(value, currency)}
    >
      <span aria-hidden>
        <CountUp
          key={value}
          to={Math.abs(value) / scale}
          decimals={value % scale === 0 ? 0 : exponent}
          separator={"\u2009"}
          decimalSeparator=","
          prefix={value < 0 ? "\u2212" : ""}
          suffix={`\u00a0${symbol}`}
          duration={0.9}
          trigger="load"
        />
      </span>
    </span>
  )
}
