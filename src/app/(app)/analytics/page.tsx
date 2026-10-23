import { useTranslations, useLocale } from "next-intl"
import { getTranslations, getLocale } from "next-intl/server"
import { DebtSummary } from "@/components/app/loans/debt-summary"
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("analytics")
  return { title: t("title") }
}

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

const monthLabel = (key: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(key + "-01T00:00:00Z")).replace(".", "")

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  const t = await getTranslations("analytics")
  const locale = await getLocale()
  const ctx = await requireHousehold()
  const sp = await searchParams
  const today = todayIn(ctx.timezone)
  const period: Period = PERIODS.includes(sp.period as Period) ? (sp.period as Period) : "month"
  const range = resolvePeriod(period, today, sp.from, sp.to)
  const a = await getAnalytics(ctx, range.from, range.to, locale)
  const cur = ctx.currency
  const topTotal = a.categories.reduce((s, c) => s + c.total, 0)

  return (
    <div className="grid grid-cols-1 gap-6">
      <FxWarnings warnings={a.warnings} canManageRates={ctx.user.role === "admin"} />
      <PageHeader title={t("title")} description={t("description", { from: formatDateFull(a.from, locale), to: formatDateFull(a.to, locale) })} />
      <DebtSummary debt={a.debt} netAssets={a.netAssets} currency={cur} />
      <AnalyticsPeriod period={period} from={range.from} to={range.to} today={today} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={t("income")} value={<Money value={a.current.income} currency={cur} tone="income" />} change={a.incomeChange} goodWhenUp />
        <Kpi label={t("expenses")} value={<Money value={a.current.expense} currency={cur} tone="expense" />} change={a.expenseChange} goodWhenUp={false} />
        <Kpi label={t("netCashFlow")} value={<Money value={a.current.net} currency={cur} tone="auto" />} />
        <Kpi
          label={t("savingsRate")}
          value={<span className="tabular">{a.current.income > 0 ? new Intl.NumberFormat(locale, { style: "percent" }).format(a.current.net / a.current.income) : "—"}</span>}
        />
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        {t("comparisonHint", { from: formatDateFull(a.previous.from, locale), to: formatDateFull(a.previous.to, locale) })}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("monthlyIncomeExpense")}</CardTitle>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={a.series.map((s) => ({ label: monthLabel(s.month, locale), income: s.income, expense: s.expense }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("topCategories")}</CardTitle>
          </CardHeader>
          <CardContent>
            {a.categories.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("noExpenses")}</p>
            ) : (
              <ul className="grid grid-cols-1 gap-3">
                {a.categories.slice(0, 8).map((c) => (
                  <li key={c.categoryId} className="grid grid-cols-1 gap-1">
                    <div className="flex items-center gap-2 text-sm">
                      <CategoryIcon icon={c.icon} color={c.color} className="size-6 rounded-md [&_svg]:size-3.5" />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="tabular text-muted-foreground">{new Intl.NumberFormat(locale, { style: "percent" }).format(c.total / topTotal)}</span>
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
            <CardTitle>{t("savingsTrend")}</CardTitle>
            <CardDescription>{t("savingsTrendHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <BalanceChart data={a.series.map((s) => ({ label: monthLabel(s.month, locale), actual: s.balance, forecast: null }))} />
          </CardContent>
        </Card>
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>{t("forecast")}</CardTitle>
            <CardDescription>{t("forecastHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-2">
              {a.forecast.map((f) => (
                <li key={f.month} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground capitalize">{monthLabel(f.month, locale)}</span>
                  <Money value={f.balance} currency={cur} tone={f.balance < 0 ? "expense" : "neutral"} className="font-medium" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("byMonth")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:hidden">
            {a.series.map((s) => (
              <section key={s.month} className="border-b pb-4 last:border-0 last:pb-0">
                <h3 className="mb-2 text-sm font-medium capitalize">{monthLabel(s.month, locale)}</h3>
                <dl className="grid grid-cols-1 gap-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{t("income")}</dt>
                    <dd><Money value={s.income} currency={cur} /></dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{t("expenses")}</dt>
                    <dd><Money value={s.expense} currency={cur} /></dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{t("flow")}</dt>
                    <dd><Money value={s.net} currency={cur} tone="auto" /></dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-muted-foreground">{t("closingBalance")}</dt>
                    <dd><Money value={s.balance} currency={cur} /></dd>
                  </div>
                </dl>
              </section>
            ))}
          </div>
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("month")}</TableHead>
                  <TableHead className="text-right">{t("income")}</TableHead>
                  <TableHead className="text-right">{t("expenses")}</TableHead>
                  <TableHead className="text-right">{t("flow")}</TableHead>
                  <TableHead className="text-right">{t("closingBalance")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.series.map((s) => (
                  <TableRow key={s.month}>
                    <TableCell className="capitalize">{monthLabel(s.month, locale)}</TableCell>
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
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Kpi({ label, value, change, goodWhenUp }: { label: string; value: React.ReactNode; change?: number | null; goodWhenUp?: boolean }) {
  const t = useTranslations("analytics")
  const locale = useLocale()
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
              t("noComparison")
            ) : (
              <>
                {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                {t("change", { value: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(change / 100) })}
              </>
            )}
          </span>
        ) : null}
      </CardHeader>
    </Card>
  )
}
