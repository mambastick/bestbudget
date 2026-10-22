import { FxWarnings } from "@/components/app/fx-warnings"
import { TrendingDown, TrendingUp } from "lucide-react"
import type { Metadata } from "next"
import { AnalyticsPeriod } from "@/components/app/analytics-period"
import { BalanceChart, IncomeExpenseChart } from "@/components/app/charts"
import { CategoryIcon } from "@/components/app/category-icon"
import { Money } from "@/components/app/money"
import { PageHeader } from "@/components/app/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { addMonths, endOfMonth, formatDateFull, isIsoDate, startOfMonth, todayIn, type IsoDate } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { requireHousehold } from "@/server/session"
import { getAnalytics } from "@/server/services/reports"

export const metadata: Metadata = { title: "Аналитика" }

const PERIODS = ["month", "prev", "3m", "6m", "12m", "custom"] as const
type Period = (typeof PERIODS)[number]

function resolvePeriod(period: Period, today: IsoDate, from?: string, to?: string): { from: IsoDate; to: IsoDate } {
  switch (period) {
    case "prev": {
      const start = addMonths(startOfMonth(today), -1)
      return { from: start, to: endOfMonth(start) }
    }
    case "3m":
      return { from: addMonths(startOfMonth(today), -2), to: today }
    case "6m":
      return { from: addMonths(startOfMonth(today), -5), to: today }
    case "12m":
      return { from: addMonths(startOfMonth(today), -11), to: today }
    case "custom":
      if (from && to && isIsoDate(from) && isIsoDate(to) && from <= to) return { from, to }
      return { from: startOfMonth(today), to: today }
    default:
      return { from: startOfMonth(today), to: endOfMonth(today) }
  }
}

const monthLabel = (key: string) =>
  new Intl.DateTimeFormat("ru-RU", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(key + "-01T00:00:00Z")).replace(".", "")

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  const ctx = await requireHousehold()
  const sp = await searchParams
  const today = todayIn(ctx.timezone)
  const period: Period = PERIODS.includes(sp.period as Period) ? (sp.period as Period) : "month"
  const range = resolvePeriod(period, today, sp.from, sp.to)
  const a = await getAnalytics(ctx, range.from, range.to)
  const cur = ctx.currency
  const topTotal = a.categories.reduce((s, c) => s + c.total, 0)

  return (
    <div className="grid grid-cols-1 gap-6">
      <FxWarnings warnings={a.warnings} />
      <PageHeader title="Аналитика" description={`Фактические операции · ${formatDateFull(a.from)} — ${formatDateFull(a.to)}`} />
      <AnalyticsPeriod period={period} from={range.from} to={range.to} today={today} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Доходы" value={<Money value={a.current.income} currency={cur} tone="income" />} change={a.incomeChange} goodWhenUp />
        <Kpi label="Расходы" value={<Money value={a.current.expense} currency={cur} tone="expense" />} change={a.expenseChange} goodWhenUp={false} />
        <Kpi label="Чистый денежный поток" value={<Money value={a.current.net} currency={cur} tone="auto" />} />
        <Kpi
          label="Норма сбережений"
          value={<span className="tabular">{a.current.income > 0 ? `${Math.round((a.current.net / a.current.income) * 100)}%` : "—"}</span>}
        />
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        Изменение — относительно предыдущего периода такой же длины ({formatDateFull(a.previous.from)} — {formatDateFull(a.previous.to)}). Переводы между своими счетами не
        учитываются.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Доходы и расходы по месяцам</CardTitle>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={a.series.map((s) => ({ label: monthLabel(s.month), income: s.income, expense: s.expense }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Крупнейшие категории расходов</CardTitle>
          </CardHeader>
          <CardContent>
            {a.categories.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Расходов за период нет</p>
            ) : (
              <ul className="grid grid-cols-1 gap-3">
                {a.categories.slice(0, 8).map((c) => (
                  <li key={c.categoryId} className="grid grid-cols-1 gap-1">
                    <div className="flex items-center gap-2 text-sm">
                      <CategoryIcon icon={c.icon} color={c.color} className="size-6 rounded-md [&_svg]:size-3.5" />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="tabular text-muted-foreground">{Math.round((c.total / topTotal) * 100)}%</span>
                      <Money value={c.total} currency={cur} className="w-28 text-right font-medium" />
                    </div>
                    <div className="ml-8 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${(c.total / a.categories[0]!.total) * 100}%`, backgroundColor: c.color }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Динамика накоплений</CardTitle>
            <CardDescription>Фактический баланс на конец каждого месяца</CardDescription>
          </CardHeader>
          <CardContent>
            <BalanceChart data={a.series.map((s) => ({ label: monthLabel(s.month), actual: s.balance, forecast: null }))} />
          </CardContent>
        </Card>
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Прогноз</CardTitle>
            <CardDescription>Ожидаемый баланс на конец месяца по плановым и регулярным операциям</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-2">
              {a.forecast.map((f) => (
                <li key={f.month} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground capitalize">{monthLabel(f.month)}</span>
                  <Money value={f.balance} currency={cur} tone={f.balance < 0 ? "expense" : "neutral"} className="font-medium" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>По месяцам</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Месяц</TableHead>
                <TableHead className="text-right">Доходы</TableHead>
                <TableHead className="text-right">Расходы</TableHead>
                <TableHead className="text-right">Поток</TableHead>
                <TableHead className="text-right">Баланс на конец</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {a.series.map((s) => (
                <TableRow key={s.month}>
                  <TableCell className="capitalize">{monthLabel(s.month)}</TableCell>
                  <TableCell className="text-right">
                    <Money value={s.income} currency={cur} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={s.expense} currency={cur} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={s.net} currency={cur} tone="auto" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={s.balance} currency={cur} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function Kpi({ label, value, change, goodWhenUp }: { label: string; value: React.ReactNode; change?: number | null; goodWhenUp?: boolean }) {
  const up = (change ?? 0) > 0
  const good = change == null || change === 0 ? null : up === goodWhenUp
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl font-semibold sm:text-2xl">{value}</CardTitle>
        {change !== undefined ? (
          <span className={cn("flex items-center gap-1 text-xs", good === null ? "text-muted-foreground" : good ? "text-income" : "text-expense")}>
            {change === null ? (
              "нет данных для сравнения"
            ) : (
              <>
                {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                {up ? "+" : ""}
                {change}% к прошлому периоду
              </>
            )}
          </span>
        ) : null}
      </CardHeader>
    </Card>
  )
}
