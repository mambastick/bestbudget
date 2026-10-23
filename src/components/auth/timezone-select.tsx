"use client"

import { useTranslations } from "next-intl"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TIMEZONES } from "@/lib/timezones"

export function TimezoneSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id?: string }) {
  const t = useTranslations("common.timezones")
  const zones = TIMEZONES.map((zone) => ({ ...zone, label: t(zone.label) }))
  const items = zones.some((t) => t.value === value) ? zones : [{ value, label: value }, ...zones]
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v as string)} items={items}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((t) => (
          <SelectItem key={t.value} value={t.value}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
