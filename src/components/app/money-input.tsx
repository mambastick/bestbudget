"use client"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** Amount input: free text with a decimal keyboard on phones; parsed with `parseMoney` on submit. */
export function MoneyInput({
  value,
  onChange,
  currency = "₽",
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> & {
  value: string
  onChange: (value: string) => void
  currency?: string
}) {
  return (
    <div className={cn("relative", className)}>
      <Input
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d\s.,]/g, ""))}
        className="tabular pr-8"
        {...props}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">{currency}</span>
    </div>
  )
}
