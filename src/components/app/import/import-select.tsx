"use client"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function ImportSelect({
  label,
  value,
  onChange,
  options,
  disabled,
  compact = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      {compact ? null : <span className="text-sm font-medium">{label}</span>}
      <Select value={value} onValueChange={(v) => v !== null && onChange(v)} disabled={disabled} items={options}>
        <SelectTrigger
          aria-label={label}
          className={
            compact
              ? "h-8 w-full min-w-0 border-transparent bg-transparent px-2 text-xs hover:bg-muted [&>span]:truncate"
              : "w-full min-w-0 [&>span]:truncate"
          }
        >
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
