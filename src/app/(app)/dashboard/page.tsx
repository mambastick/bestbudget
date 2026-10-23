import { householdAiView } from "@/server/ai/access"
import { useTranslations } from "next-intl"
import { getTranslations, getLocale } from "next-intl/server"
import { GoalsWidget } from "@/components/app/goals/goals-widget"
import { DebtSummary } from "@/components/app/loans/debt-summary"
import { FxWarnings } from "@/components/app/fx-warnings"
import { CalendarClock, Info, PieChart, Plus } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { LinkButton } from "@/components/app/link-button"
import { AnimatedMoney } from "@/components/app/animated-money"
import { BalanceHero } from "@/components/app/balance-hero"
import { BalanceChart, CategoryDonut, ForecastChart, IncomeExpenseChart } from "@/components/app/charts"
import { EmptyState } from "@/components/app/empty-state"
import { Money } from "@/components/app/money"
import { MonthSwitcher } from "@/components/app/month-switcher"
import { UpcomingList } from "@/components/app/operations/upcoming-list"
import { PageHeader } from "@/components/app/page-header"
import { QuickAddButton } from "@/components/app/operations/quick-add-button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatDay, formatDayShort, formatMonth, monthKey, parseMonthKey, todayIn } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { requireHousehold } from "@/server/session"
import { getDashboard } from "@/server/services/reports"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard")
  return { title: t("title") }
}

const shortMonth = (key: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(key + "-01T00:00:00Z")).replace(".", "")

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const t = await getTranslations("dashboard")
  const locale = await getLocale()
  const ctx = await requireHousehold()
  const today = todayIn(ctx.timezone)
  const month = parseMonthKey((await searchParams).month, today)
  const ai = await householdAiView(ctx)
  const aiT = await getTranslations("ai")
  const d = await getDashboard(ctx, month, locale)
  const cur = ctx.currency
  const isCurrent = monthKey(month) === monthKey(today)
  const isPast = monthKey(month) < monthKey(today)

  const balanceData = d.monthDays.map((day) => ({
    label: formatDayShort(day.date, locale),
    actual: day.date <= today ? day.balance : null,
    forecast: day.date >= today ? day.balance : null,
  }))
  const firstNegative = d.forecast.find((day) => day.balance < 0)
  const empty = d.balance === 0 && d.monthIncome === 0 && d.monthExpense === 0 && d.upcoming.length === 0

  return (
    <div className="grid grid-cols-1 gap-6">
      <FxWarnings warnings={d.warnings} canManageRates={ctx.user.role === "admin"} />
      <PageHeader title={t("title")} description={t("description", { month: formatMonth(month, locale) })} actions={<MonthSwitcher month={month} today={today} basePath="/dashboard" />} />

      {ai.enabled ? <LinkButton href="/assistant" variant="outline" className="justify-self-start">{aiT("title")}</LinkButton> : null}
      {empty ? (
        <EmptyState
          icon={Plus}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={<QuickAddButton label={t("addTransaction")} />}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BalanceHero className="lg:col-span-1" title={d.valuationNote ?? undefined}>
          <div className="grid gap-1 p-5">
            <div className="text-sm text-muted-foreground">{t("actualBalance")}</div>
            <div className="text-3xl font-semibold tracking-tight sm:text-4xl">
              <AnimatedMoney value={d.balance} currency={cur} tone={d.balance < 0 ? "expense" : "neutral"} />
            </div>
            <p className="text-xs text-muted-foreground">{t("balanceHint")}</p>
            {d.valuationNote ? <p className="text-xs text-muted-foreground">{d.valuationNote}</p> : null}
            {d.staleRateNotes.map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
          </div>
          <div className="grid grid-cols-1 gap-3 border-t p-5">
            <Metric label={t("forecastOn", { date: formatDay(d.monthDays.at(-1)?.date ?? today, locale) })} hint={t("forecastHint")}>
              <Money value={d.forecastEndOfMonth} currency={cur} tone={d.forecastEndOfMonth < 0 ? "expense" : "neutral"} />
            </Metric>
            <Metric
              label={t("available")}
              hint={t("availableHint", { date: formatDay(d.obligationsUntil, locale) })}
            >
              <Money value={d.availableAfterObligations} currency={cur} tone={d.availableAfterObligations < 0 ? "expense" : "income"} />
            </Metric>
          </div>
        </BalanceHero>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
          <StatCard label={t("monthIncome")} sub={t("actual")} value={d.monthIncome} kind="income" currency={cur} />
          <StatCard label={t("monthExpense")} sub={t("actual")} value={d.monthExpense} kind="expense" currency={cur} />
          <StatCard
            testId="planned-income"
            label={isPast ? t("unconfirmedIncome") : t("expectedIncome")}
            sub={isCurrent ? t("untilMonthEnd") : t("planned")}
            value={d.plannedIncome}
            kind="income"
            currency={cur}
            planned
          />
          <StatCard
            label={isPast ? t("unconfirmedExpense") : t("plannedExpense")}
            sub={isCurrent ? t("untilMonthEnd") : t("planned")}
            value={d.plannedExpense}
            kind="expense"
            currency={cur}
            planned
          />
        </div>
      </div>

      <DebtSummary debt={d.debt} netAssets={d.netAssets} currency={cur} next={d.nextLoanPayment} />

      {firstNegative ? (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <span className="font-medium">{t("cashGapOn", { date: formatDay(firstNegative.date, locale) })}</span>{" "}
            <span className="text-muted-foreground">
              {t.rich("negativeBalance", { amount: () => <Money value={firstNegative.balance} currency={cur} /> })}{" "}
              <Link className="underline underline-offset-4" href={`/calendar?month=${monthKey(firstNegative.date)}`}>
                {t("openCalendar")}
              </Link>
            </span>
          </div>
        </div>
      ) : null}

      <GoalsWidget ctx={ctx} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>{t("balanceByDay")}</CardTitle>
            <CardDescription>{t("balanceByDayHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <BalanceChart data={balanceData} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>{t("upcoming")}</CardTitle>
              <CardDescription>{t("nextThirtyDays")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {d.upcoming.length > 0 ? (
              <UpcomingList items={d.upcoming} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("noUpcoming")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("incomeExpense")}</CardTitle>
            <CardDescription>{t("sixMonthsActual")}</CardDescription>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={d.trend.map((t) => ({ label: shortMonth(t.month, locale), income: t.income, expense: t.expense }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("categoryExpenses")}</CardTitle>
            <CardDescription>{t("categoryMonth", { month: formatMonth(month, locale) })}</CardDescription>
          </CardHeader>
          <CardContent>
            {d.byCategory.length > 0 ? (
              <CategoryDonut data={d.byCategory.map((c) => ({ name: c.name, total: c.total, color: c.color }))} currency={cur} />
            ) : (
              <EmptyState icon={PieChart} title={t("noExpenses")} description={t("noExpensesHint")} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("cashFlowForecast")}</CardTitle>
          <CardDescription>{t("cashFlowForecastHint")}</CardDescription>
          <CardAction>
            <LinkButton variant="ghost" size="sm" href="/calendar">
              {t("calendar")}
            </LinkButton>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ForecastChart data={d.forecast.map((f) => ({ label: formatDayShort(f.date, locale), balance: f.balance }))} />
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  const t = useTranslations("dashboard")
  return (
    <div className="grid gap-0.5 text-sm">
      <span className="flex items-center gap-1 text-muted-foreground">
        {label}
        <Tooltip>
          <TooltipTrigger render={<button type="button" className="text-muted-foreground/70 hover:text-foreground" aria-label={t("explanation")} />}>
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{hint}</TooltipContent>
        </Tooltip>
      </span>
      <span className="text-lg font-semibold">{children}</span>
    </div>
  )
}

function StatCard({
  testId,
  label,
  sub,
  value,
  kind,
  currency,
  planned,
}: {
  testId?: string
  label: string
  sub: string
  value: number
  kind: "income" | "expense"
  currency: string
  planned?: boolean
}) {
  return (
    <Card size="sm" data-testid={testId} className={cn(planned && "border-dashed bg-transparent shadow-none ring-0 outline outline-1 -outline-offset-1 outline-border")}>
      <CardHeader>
        <CardDescription>
          <span className="block leading-snug">{label}</span>
          <span className="block text-xs text-muted-foreground/80">{sub}</span>
        </CardDescription>
        <CardTitle className="text-xl font-semibold sm:text-2xl">
          <AnimatedMoney value={value} currency={currency} tone={planned ? "neutral" : kind} />
        </CardTitle>
      </CardHeader>
    </Card>
  )
}
