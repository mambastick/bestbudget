import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

type Tone = "auto" | "income" | "expense" | "neutral"

/**
 * A formatted amount. `tone="auto"` colors by sign; `kind` renders the operation sign (+ income, − expense).
 */
export function Money({
  value,
  currency = "RUB",
  kind,
  tone = "neutral",
  className,
}: {
  value: number
  currency?: string
  kind?: "income" | "expense" | "transfer"
  tone?: Tone
  className?: string
}) {
  const signed = kind === "expense" ? -Math.abs(value) : kind === "income" ? Math.abs(value) : value
  const resolved = tone === "auto" ? (signed > 0 ? "income" : signed < 0 ? "expense" : "neutral") : tone
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        resolved === "income" && "text-income",
        resolved === "expense" && "text-expense",
        className,
      )}
    >
      {formatMoney(signed, currency, { sign: kind === "income" })}
    </span>
  )
}
