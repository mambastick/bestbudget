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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatDay, formatDayShort, formatMonth, monthKey, parseMonthKey, todayIn } from "@/lib/dates"
import { cn } from "@/lib/utils"
import { requireHousehold } from "@/server/session"
import { getDashboard } from "@/server/services/reports"

export const metadata: Metadata = { title: "Обзор" }

const shortMonth = (key: string) =>
  new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" }).format(new Date(key + "-01T00:00:00Z")).replace(".", "")

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireHousehold()
  const today = todayIn(ctx.timezone)
  const month = parseMonthKey((await searchParams).month, today)
  const d = await getDashboard(ctx, month)
  const cur = ctx.currency
  const isCurrent = monthKey(month) === monthKey(today)
  const isPast = monthKey(month) < monthKey(today)

  const balanceData = d.monthDays.map((day) => ({
    label: formatDayShort(day.date),
    actual: day.date <= today ? day.balance : null,
    forecast: day.date >= today ? day.balance : null,
  }))
  const firstNegative = d.forecast.find((day) => day.balance < 0)
  const empty = d.balance === 0 && d.monthIncome === 0 && d.monthExpense === 0 && d.upcoming.length === 0

  return (
    <div className="grid grid-cols-1 gap-6">
      <FxWarnings warnings={d.warnings} canManageRates={ctx.user.role === "admin"} />
      <PageHeader title="Обзор" description={`Финансы семьи · ${formatMonth(month)}`} actions={<MonthSwitcher month={month} today={today} basePath="/dashboard" />} />

      {empty ? (
        <EmptyState
          icon={Plus}
          title="Начните с первой операции"
          description="Добавьте зарплату как регулярный доход, обязательные платежи и текущие расходы — обзор и прогноз построятся автоматически."
          action={<QuickAddButton label="Добавить операцию" />}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BalanceHero className="lg:col-span-1" title={d.valuationNote ?? undefined}>
          <div className="grid gap-1 p-5">
            <div className="text-sm text-muted-foreground">Фактический баланс</div>
            <div className="text-3xl font-semibold tracking-tight sm:text-4xl">
              <AnimatedMoney value={d.balance} currency={cur} tone={d.balance < 0 ? "expense" : "neutral"} />
            </div>
            <p className="text-xs text-muted-foreground">Все счета, только подтверждённые операции</p>
            {d.valuationNote ? <p className="text-xs text-muted-foreground">{d.valuationNote}</p> : null}
            {d.staleRateNotes.map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
          </div>
          <div className="grid grid-cols-1 gap-3 border-t p-5">
            <Metric label={`Прогноз на ${formatDay(d.monthDays.at(-1)?.date ?? today)}`} hint="Фактический баланс плюс ожидаемые доходы и минус запланированные расходы до конца месяца">
              <Money value={d.forecastEndOfMonth} currency={cur} tone={d.forecastEndOfMonth < 0 ? "expense" : "neutral"} />
            </Metric>
            <Metric
              label="Доступно после обязательных платежей"
              hint={`Фактический баланс минус все запланированные расходы до ${formatDay(d.obligationsUntil)}, без учёта ещё не полученных доходов`}
            >
              <Money value={d.availableAfterObligations} currency={cur} tone={d.availableAfterObligations < 0 ? "expense" : "income"} />
            </Metric>
          </div>
        </BalanceHero>

        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatCard label="Доходы за месяц" sub="факт" value={d.monthIncome} kind="income" currency={cur} />
          <StatCard label="Расходы за месяц" sub="факт" value={d.monthExpense} kind="expense" currency={cur} />
          <StatCard
            testId="planned-income"
            label={isPast ? "Не подтверждено доходов" : "Ожидаемые доходы"}
            sub={isCurrent ? "до конца месяца" : "план"}
            value={d.plannedIncome}
            kind="income"
            currency={cur}
            planned
          />
          <StatCard
            label={isPast ? "Не подтверждено расходов" : "Запланированные расходы"}
            sub={isCurrent ? "до конца месяца" : "план"}
            value={d.plannedExpense}
            kind="expense"
            currency={cur}
            planned
          />
        </div>
      </div>

      {firstNegative ? (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <span className="font-medium">Возможен кассовый разрыв {formatDay(firstNegative.date)}.</span>{" "}
            <span className="text-muted-foreground">
              Прогнозируемый баланс уйдёт в минус: <Money value={firstNegative.balance} currency={cur} />.{" "}
              <Link className="underline underline-offset-4" href={`/calendar?month=${monthKey(firstNegative.date)}`}>
                Открыть календарь
              </Link>
            </span>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Баланс по дням</CardTitle>
            <CardDescription>Сплошная линия — факт, пунктир — прогноз по плановым операциям</CardDescription>
          </CardHeader>
          <CardContent>
            <BalanceChart data={balanceData} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Ближайшие операции</CardTitle>
              <CardDescription>На 30 дней вперёд</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {d.upcoming.length > 0 ? (
              <UpcomingList items={d.upcoming} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">Запланированных операций нет. Добавьте регулярные платежи — они появятся здесь.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Доходы и расходы</CardTitle>
            <CardDescription>Фактические суммы за 6 месяцев</CardDescription>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={d.trend.map((t) => ({ label: shortMonth(t.month), income: t.income, expense: t.expense }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Расходы по категориям</CardTitle>
            <CardDescription>{formatMonth(month)}, факт</CardDescription>
          </CardHeader>
          <CardContent>
            {d.byCategory.length > 0 ? (
              <CategoryDonut data={d.byCategory.map((c) => ({ name: c.name, total: c.total, color: c.color }))} currency={cur} />
            ) : (
              <EmptyState icon={PieChart} title="Пока нет расходов" description="Подтверждённые расходы за месяц появятся здесь." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Прогноз движения денег</CardTitle>
            <CardDescription>Баланс на 90 дней вперёд с учётом регулярных и плановых операций</CardDescription>
          </div>
          <LinkButton variant="outline" size="sm" href="/calendar">
            Календарь
          </LinkButton>
        </CardHeader>
        <CardContent>
          <ForecastChart data={d.forecast.map((f) => ({ label: formatDayShort(f.date), balance: f.balance }))} />
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 text-sm">
      <span className="flex items-center gap-1 text-muted-foreground">
        {label}
        <Tooltip>
          <TooltipTrigger render={<button type="button" className="text-muted-foreground/70 hover:text-foreground" aria-label="Пояснение" />}>
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
