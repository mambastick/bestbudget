"use client"

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { useCatalog } from "./operations/catalog-context"
import { formatMoney, formatMoneyCompact } from "@/lib/money"

/**
 * Chart conventions: one y-axis, thin marks, recessive grid, legend for ≥2 series,
 * hover tooltip on every chart. Colors come from the validated --chart-* slots.
 */

type TooltipRow = { name: string; value: number; color: string }

function MoneyTooltip({ active, label, rows }: { active?: boolean; label?: React.ReactNode; rows: TooltipRow[] }) {
  const { currency } = useCatalog()
  if (!active || rows.length === 0) return null
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {label ? <div className="font-medium">{label}</div> : null}
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: r.color }} />
          <span className="flex-1 text-muted-foreground">{r.name}</span>
          <span className="tabular font-medium">{formatMoney(r.value, currency)}</span>
        </div>
      ))}
    </div>
  )
}

type RechartsTooltipProps = {
  active?: boolean
  label?: string | number
  payload?: ReadonlyArray<{ name?: string | number; value?: unknown; color?: string; dataKey?: unknown; payload?: Record<string, unknown> }>
}

function rowsFrom(props: RechartsTooltipProps, config: ChartConfig): TooltipRow[] {
  return (props.payload ?? [])
    .filter((p) => typeof p.value === "number")
    .map((p) => {
      const key = String(p.dataKey ?? p.name)
      return { name: String(config[key]?.label ?? p.name), value: p.value as number, color: p.color ?? `var(--color-${key})` }
    })
}

const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: "var(--muted-foreground)", fontSize: 11 },
} as const

/** Y axis for money: rubles-rounded ticks, no duplicates when all values are equal. */
function useMoneyAxis() {
  const { currency } = useCatalog()
  return {
    ...axisProps,
    width: 80,
    allowDecimals: false,
    tickCount: 5,
    domain: [(min: number) => Math.min(0, min), (max: number) => (max <= 0 ? 100_00 : max)] as [(v: number) => number, (v: number) => number],
    tickFormatter: (v: number) => formatMoneyCompact(v, currency),
  }
}

// ---------------------------------------------------------------------------

const incomeExpenseConfig = {
  income: { label: "Доходы", color: "var(--chart-3)" },
  expense: { label: "Расходы", color: "var(--chart-2)" },
} satisfies ChartConfig

export function IncomeExpenseChart({ data, className }: { data: { label: string; income: number; expense: number }[]; className?: string }) {
  const moneyAxis = useMoneyAxis()
  return (
    <ChartContainer config={incomeExpenseConfig} className={className ?? "aspect-auto h-64 w-full"}>
      <BarChart data={data} barGap={2} margin={{ left: 4, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis dataKey="label" {...axisProps} tickMargin={8} />
        <YAxis {...moneyAxis} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={(p: RechartsTooltipProps) => <MoneyTooltip active={p.active} label={p.label} rows={rowsFrom(p, incomeExpenseConfig)} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expense" fill="var(--color-expense)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartContainer>
  )
}

// ---------------------------------------------------------------------------

const balanceConfig = {
  actual: { label: "Фактический баланс", color: "var(--chart-1)" },
  forecast: { label: "Прогноз", color: "var(--chart-1)" },
} satisfies ChartConfig

/** Daily balance: solid line for actual days, dashed for the forecast. Zero line when the balance dips below it. */
export function BalanceChart({
  data,
  className,
}: {
  data: { label: string; actual: number | null; forecast: number | null }[]
  className?: string
}) {
  const moneyAxis = useMoneyAxis()
  const values = data.flatMap((d) => [d.actual, d.forecast]).filter((v): v is number => v !== null)
  const hasNegative = values.some((v) => v < 0)
  const hasActual = data.some((d) => d.actual !== null)
  const hasForecast = data.some((d) => d.forecast !== null)
  return (
    <ChartContainer config={balanceConfig} className={className ?? "aspect-auto h-64 w-full"}>
      <LineChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis dataKey="label" {...axisProps} tickMargin={8} minTickGap={24} />
        <YAxis {...moneyAxis} />
        {hasNegative ? <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 4" /> : null}
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={(p: RechartsTooltipProps) => {
            // At the "today" seam both series carry the same value; show it once.
            const rows = rowsFrom(p, balanceConfig)
            return <MoneyTooltip active={p.active} label={p.label} rows={rows.length === 2 && rows[0]!.value === rows[1]!.value ? [rows[0]!] : rows} />
          }}
        />
        {hasActual && hasForecast ? <ChartLegend content={<ChartLegendContent />} /> : null}
        <Line dataKey="actual" stroke="var(--color-actual)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
        <Line
          dataKey="forecast"
          stroke="var(--color-forecast)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          connectNulls={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  )
}

// ---------------------------------------------------------------------------

const forecastConfig = { balance: { label: "Прогноз баланса", color: "var(--chart-1)" } } satisfies ChartConfig

export function ForecastChart({ data, className }: { data: { label: string; balance: number }[]; className?: string }) {
  const moneyAxis = useMoneyAxis()
  const hasNegative = data.some((d) => d.balance < 0)
  return (
    <ChartContainer config={forecastConfig} className={className ?? "aspect-auto h-56 w-full"}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-balance)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-balance)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis dataKey="label" {...axisProps} tickMargin={8} minTickGap={32} />
        <YAxis {...moneyAxis} />
        {hasNegative ? <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="4 4" /> : null}
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={(p: RechartsTooltipProps) => <MoneyTooltip active={p.active} label={p.label} rows={rowsFrom(p, forecastConfig)} />}
        />
        <Area dataKey="balance" type="stepAfter" stroke="var(--color-balance)" strokeWidth={2} fill="url(#forecastFill)" isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
  )
}

// ---------------------------------------------------------------------------

/**
 * Spending by category. Each slice keeps its category's own color (color follows the entity);
 * beyond six categories the rest fold into "Другое". The list beside it doubles as the table view.
 */
export function CategoryDonut({ data, currency = "RUB" }: { data: { name: string; total: number; color: string }[]; currency?: string }) {
  const top = data.slice(0, 6)
  const rest = data.slice(6).reduce((s, d) => s + d.total, 0)
  const slices = rest > 0 ? [...top, { name: "Другое", total: rest, color: "#94a3b8" }] : top
  const total = slices.reduce((s, d) => s + d.total, 0)
  const config: ChartConfig = Object.fromEntries(slices.map((s, i) => [`c${i}`, { label: s.name, color: s.color }]))
  return (
    <div className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[144px_minmax(0,1fr)] xl:grid-cols-[120px_minmax(0,1fr)]">
      <ChartContainer config={config} className="mx-auto aspect-square w-full max-w-36 xl:max-w-30">
        <PieChart>
          <ChartTooltip
            content={(p: RechartsTooltipProps) => {
              const item = p.payload?.[0]
              if (!p.active || !item) return null
              const slice = item.payload as { name: string; total: number; color: string }
              return <MoneyTooltip active label={slice.name} rows={[{ name: `${Math.round((slice.total / total) * 100)}%`, value: slice.total, color: slice.color }]} />
            }}
          />
          <Pie data={slices} dataKey="total" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={1} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
            {slices.map((s) => (
              <Cell key={s.name} fill={s.color} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="grid grid-cols-1 gap-2 text-sm">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} />
            <span className="min-w-0 flex-1 truncate xl:overflow-visible xl:whitespace-normal xl:break-words xl:text-clip">{s.name}</span>
            <span className="shrink-0 tabular text-muted-foreground">{Math.round((s.total / total) * 100)}%</span>
            <span className="shrink-0 tabular text-right font-medium">{formatMoney(s.total, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
