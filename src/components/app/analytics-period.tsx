"use client"

import { usePathname, useRouter } from "next/navigation"
import { DateField } from "@/components/app/date-field"
import { Segmented } from "@/components/app/segmented"
import type { IsoDate } from "@/lib/dates"

const OPTIONS = [
  { value: "month", label: "Месяц" },
  { value: "prev", label: "Прошлый" },
  { value: "3m", label: "3 мес." },
  { value: "6m", label: "6 мес." },
  { value: "12m", label: "Год" },
  { value: "custom", label: "Период" },
] as const

export function AnalyticsPeriod({ period, from, to, today }: { period: string; from: IsoDate; to: IsoDate; today: IsoDate }) {
  const router = useRouter()
  const pathname = usePathname()
  const go = (p: Record<string, string>) => router.replace(`${pathname}?${new URLSearchParams(p)}`, { scroll: false })
  return (
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <Segmented
        value={period as (typeof OPTIONS)[number]["value"]}
        onChange={(v) => go(v === "custom" ? { period: v, from, to } : { period: v })}
        options={[...OPTIONS]}
        size="sm"
        className="sm:w-auto"
      />
      {period === "custom" ? (
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <DateField value={from} onChange={(v) => v && go({ period, from: v, to })} today={today} className="sm:w-48" />
          <DateField value={to} onChange={(v) => v && go({ period, from, to: v })} today={today} className="sm:w-48" />
        </div>
      ) : null}
    </div>
  )
}
