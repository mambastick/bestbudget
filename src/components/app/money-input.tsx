"use client"

import { useLocale } from "next-intl"
import { normalizeMoneySeparators } from "@/lib/money"
import { useLayoutEffect, useRef } from "react"
import { Input } from "@/components/ui/input"
import { currencyExponent, currencySymbol } from "@/lib/currencies"
import { cn } from "@/lib/utils"

const GROUP = "\u2009" // thin space: groups stay readable without looking like separate numbers

/**
 * Normalizes typed text to `12 345 678,50`: digits grouped by thousands, one decimal comma,
 * at most the currency exponent decimals. Accepts "." as decimal separator and pasted values with spaces.
 */
export function formatMoneyInput(raw: string, currency = "RUB", locale = "ru"): string {
  const cleaned = normalizeMoneySeparators(raw.replace(/[^\d.,]/g, ""))
  if (cleaned === null) return raw
  const decimal = locale.startsWith("ru") ? "," : "."
  const [intRaw = "", ...rest] = cleaned.split(".")
  const intDigits = intRaw.replace(/^0+(?=\d)/, "")
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP)
  const exponent = currencyExponent(currency)
  if (rest.length === 0 || exponent === 0) return grouped
  return `${grouped || "0"}${decimal}${rest.join("").slice(0, exponent)}`
}

/** Number of digits (and the decimal comma) before position `pos`: a caret anchor that survives regrouping. */
function anchorAt(value: string, pos: number) {
  return value.slice(0, pos).replace(/[^\d.,]/g, "").length
}

function positionFor(value: string, anchor: number) {
  if (anchor === 0) return 0
  let seen = 0
  for (let i = 0; i < value.length; i++) {
    if (/[\d.,]/.test(value[i]!)) seen++
    if (seen === anchor) return i + 1
  }
  return value.length
}

/** Amount input: grouped digits while typing, decimal keyboard on phones. Parse with `parseMoney`. */
export function MoneyInput({
  value,
  onChange,
  currency = "RUB",
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string
  onChange: (value: string) => void
  currency?: string
}) {
  const locale = useLocale()
  const ref = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  const display = formatMoneyInput(value, currency, locale)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && caret.current !== null && document.activeElement === el) {
      const pos = positionFor(display, caret.current)
      el.setSelectionRange(pos, pos)
      caret.current = null
    }
  }, [display])

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={display}
        onChange={(e) => {
          caret.current = anchorAt(e.target.value, e.target.selectionStart ?? e.target.value.length)
          onChange(formatMoneyInput(e.target.value, currency, locale))
        }}
        className="tabular pr-14"
        {...props}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">{currencySymbol(currency, locale)}</span>
    </div>
  )
}
