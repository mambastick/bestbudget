"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

/** Single-choice segmented control on top of ToggleGroup. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "default",
  disabled,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: React.ReactNode }[]
  className?: string
  size?: "sm" | "default"
  disabled?: boolean
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v) => v[0] && onChange(v[0] as T)}
      spacing={0}
      variant="outline"
      size={size}
      disabled={disabled}
      className={cn("w-full", className)}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="flex-1 data-pressed:bg-primary/10 data-pressed:text-primary">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
