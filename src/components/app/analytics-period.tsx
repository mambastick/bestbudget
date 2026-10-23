"use client"

import { useTranslations } from "next-intl"
import { usePathname, useRouter } from "next/navigation"
import { DateField } from "@/components/app/date-field"
import { Segmented } from "@/components/app/segmented"
import type { IsoDate } from "@/lib/dates"

export function AnalyticsPeriod({ period, from, to, today }: { period: string; from: IsoDate; to: IsoDate; today: IsoDate }) {
  const t = useTranslations("analytics")
  const OPTIONS = [
    { value: "month", label: t("month") },
    { value: "prev", label: t("previous") },
    { value: "3m", label: t("threeMonths") },
    { value: "6m", label: t("sixMonths") },
    { value: "12m", label: t("year") },
    { value: "custom", label: t("custom") },
  ] as const
  const router = useRouter()
  const pathname = usePathname()
  const go = (p: Record<string, string>) => router.replace(`${pathname}?${new URLSearchParams(p)}`, { scroll: false })
  return (
    <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <Segmented
        aria-label={t("periodLabel")}
        value={period as (typeof OPTIONS)[number]["value"]}
        onChange={(v) => go(v === "custom" ? { period: v, from, to } : { period: v })}
        options={[...OPTIONS]}
        size="sm"
        className="sm:w-auto [&_[role=radio]]:px-1 sm:[&_[role=radio]]:px-3"
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
