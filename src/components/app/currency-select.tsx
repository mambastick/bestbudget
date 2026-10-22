"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CURRENCY_CODES, currencySymbol, type Currency } from "@/lib/currencies"

export function CurrencySelect({ value, onChange, disabled, id }: { value: string; onChange: (value: Currency) => void; disabled?: boolean; id?: string }) {
  const items = CURRENCY_CODES.map((code) => ({ value: code, label: `${code} · ${currencySymbol(code)}` }))
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as Currency)} disabled={disabled} items={items}>
      <SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
    </Select>
  )
}
