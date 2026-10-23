"use client"

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from "@/components/ui/chart"
import { formatDateFull } from "@/lib/dates"
import { formatMoney, formatMoneyCompact } from "@/lib/money"

const config = {
  actual: { label: "Накоплено", color: "var(--chart-1)" },
  forecast: { label: "При текущем темпе", color: "var(--chart-3)" },
  planned: { label: "По плановым операциям", color: "var(--chart-4)" },
}

export function GoalChart({
  data,
  currency,
  target,
}: {
  data: { date: string; actual: number | null; forecast: number | null; planned: number | null }[]
  currency: string
  target: number | null
}) {
  return (
    <ChartContainer config={config} className="h-72 w-full min-w-0 aspect-auto">
      <LineChart data={data} margin={{ top: 10, right: 8, left: 0 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis
          dataKey="date"
          tickFormatter={(v: string) => v.slice(5, 7) + "." + v.slice(2, 4)}
          tickLine={false}
          axisLine={false}
          minTickGap={30}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          tickFormatter={(v: number) => formatMoneyCompact(v, currency)}
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
                <p>{formatDateFull(String(label))}</p>
                {payload
                  ?.filter((p) => typeof p.value === "number")
                  .map((p) => (
                    <p key={String(p.dataKey)} className="mt-1" style={{ color: p.color }}>
                      {config[p.dataKey as keyof typeof config]?.label}: {formatMoney(Number(p.value), currency)}
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
