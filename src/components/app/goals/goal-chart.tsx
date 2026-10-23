"use client"

import { useTranslations, useLocale } from "next-intl"

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from "@/components/ui/chart"
import { formatDateFull, formatMonth } from "@/lib/dates"
import { formatMoney, formatMoneyCompact } from "@/lib/money"

export function GoalChart({
  data,
  currency,
  target,
}: {
  data: { date: string; actual: number | null; forecast: number | null; planned: number | null }[]
  currency: string
  target: number | null
}) {
  const t = useTranslations("goals")
  const locale = useLocale()
  const config = {
    actual: { label: t("chart.actual"), color: "var(--chart-1)" },
    forecast: { label: t("chart.forecast"), color: "var(--chart-3)" },
    planned: { label: t("chart.planned"), color: "var(--chart-4)" },
  }

  return (
    <ChartContainer config={config} className="h-72 w-full min-w-0 aspect-auto">
      <LineChart data={data} margin={{ top: 10, right: 8, left: 0 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis
          dataKey="date"
          tickFormatter={(v: string) => formatMonth(v, locale)}
          tickLine={false}
          axisLine={false}
          minTickGap={30}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          tickFormatter={(v: number) => formatMoneyCompact(v, currency, locale)}
          tickLine={false}
          axisLine={false}
          width={80}
          tick={{ fontSize: 11 }}
        />
        {target !== null ? <ReferenceLine y={target} stroke="var(--chart-2)" strokeDasharray="3 3" /> : null}
        <ChartTooltip
          content={({ active, label, payload }) =>
            active ? (
              <div className="max-w-64 rounded-lg border bg-popover p-3 text-xs shadow-md">
                <p>{formatDateFull(String(label), locale)}</p>
                {payload
                  ?.filter((p) => typeof p.value === "number")
                  .map((p) => (
                    <p key={String(p.dataKey)} className="mt-1" style={{ color: p.color }}>
                      {config[p.dataKey as keyof typeof config]?.label}: {formatMoney(Number(p.value), currency, { locale })}
                    </p>
                  ))}
              </div>
            ) : null
          }
        />
        <ChartLegend content={<ChartLegendContent className="flex-wrap" />} />
        <Line dataKey="actual" stroke="var(--color-actual)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line
          dataKey="forecast"
          stroke="var(--color-forecast)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          isAnimationActive={false}
        />
        <Line dataKey="planned" stroke="var(--color-planned)" strokeWidth={2} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  )
}
