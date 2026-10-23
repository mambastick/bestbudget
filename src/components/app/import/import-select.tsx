"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function ImportSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Select value={value} onValueChange={(v) => v !== null && onChange(v)} disabled={disabled} items={options}>
        <SelectTrigger aria-label={label} className="w-full min-w-0 [&>span]:truncate">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
