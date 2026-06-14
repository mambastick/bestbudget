import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CalendarPlusIcon,
  FileTextIcon,
  LandmarkIcon,
  PiggyBankIcon,
  PlusIcon,
  ExternalLinkIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  WalletIcon,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"

import type { SsoIdpConfig } from "@/components/app/dialogs"
import {
  permissionLabels,
  permissionOrder,
  readonlyReason,
  roleDescriptions,
  roleLabels,
  type WorkspacePermissions,
} from "@/components/app/permissions"
import { AnimatedList } from "@/components/reactbits/animated-list"
import { FadeContent } from "@/components/reactbits/fade-content"
import { Magnet } from "@/components/reactbits/magnet"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateKey, formatHumanDate, formatMoney, getInitials } from "@/domain/format"
import { getCurrency } from "@/domain/presets"
import { getCategory, matchesSearch, summarizeWorkspace } from "@/domain/selectors"
import { cn } from "@/lib/utils"
import type {
  Budget,
  Category,
  DocumentRecord,
  Liability,
  Transaction,
  User,
  Workspace,
} from "@/domain/types"

type DialogName =
  | "workspace"
  | "sso"
  | "transaction"
  | "budget"
  | "invite"
  | "liability"
  | "document"

const chartConfig = {
  income: {
    label: "Доход",
    color: "var(--chart-1)",
  },
  expense: {
    label: "Расход",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig

const memberStatusLabels: Record<Workspace["members"][number]["status"], string> = {
  active: "Доступ открыт",
  invited: "Приглашение отправлено",
}

const documentStatusLabels: Record<DocumentRecord["status"], string> = {
  uploaded: "Загружен",
  checked: "Проверен",
}

const budgetPeriodLabels: Record<Budget["period"], string> = {
  month: "Месяц",
  quarter: "Квартал",
  year: "Год",
}

const monthFormatter = new Intl.DateTimeFormat("ru-RU", {
  month: "long",
  year: "numeric",
})
const periodDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
})
const weekdayFormatter = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
})
const dayLabelFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  weekday: "long",
  year: "numeric",
})

function formatCalendarMonth(date: Date) {
  return monthFormatter.format(date)
}

function formatCalendarWeekday(date: Date) {
  return weekdayFormatter.format(date).replace(".", "")
}

function labelCalendarDay(date: Date, modifiers: Record<string, boolean>) {
  const states = [
    modifiers.today ? "сегодня" : "",
    modifiers.selected ? "выбрано" : "",
  ].filter(Boolean)

  return [dayLabelFormatter.format(date), ...states].join(", ")
}

function getCurrentBudgetPeriod(period: Budget["period"]) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()

  if (period === "year") {
    return {
      start: new Date(year, 0, 1),
      end: new Date(year + 1, 0, 1),
    }
  }

  if (period === "quarter") {
    const quarterStartMonth = Math.floor(month / 3) * 3

    return {
      start: new Date(year, quarterStartMonth, 1),
      end: new Date(year, quarterStartMonth + 3, 1),
    }
  }

  return {
    start: new Date(year, month, 1),
    end: new Date(year, month + 1, 1),
  }
}

function isDateInPeriod(dateKey: string, period: ReturnType<typeof getCurrentBudgetPeriod>) {
  const date = new Date(`${dateKey}T12:00:00`)

  return !Number.isNaN(date.getTime()) && date >= period.start && date < period.end
}

function formatBudgetPeriodRange(period: ReturnType<typeof getCurrentBudgetPeriod>) {
  const inclusiveEnd = new Date(period.end)
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1)

  return `${periodDateFormatter.format(period.start)} - ${periodDateFormatter.format(inclusiveEnd)}`
}

function formatFileSize(value?: number) {
  if (!value) {
    return "размер не сохранен"
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)} МБ`
  }

  return `${Math.max(1, Math.round(value / 1_000))} КБ`
}

function formatSsoProviderKind(kind: SsoIdpConfig["providerKind"]) {
  if (kind === "keycloak") {
    return "Keycloak"
  }

  if (kind === "authentik") {
    return "Authentik"
  }

  return kind === "saml" ? "SAML" : "OIDC"
}

export function PageHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function PermissionBadges({ permissions }: { permissions: WorkspacePermissions }) {
  return (
    <div className="flex flex-wrap gap-2">
      {permissionOrder.map((permission) => {
        const allowed = permissions[permission]

        return (
          <Badge
            key={permission}
            variant={allowed ? "secondary" : "outline"}
            className={cn(
              "max-w-full",
              !allowed && "text-muted-foreground"
            )}
          >
            <span className="truncate">
              {permissionLabels[permission]}: {allowed ? "да" : "нет"}
            </span>
          </Badge>
        )
      })}
    </div>
  )
}

function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Бюджет еще не создан</CardTitle>
        <CardDescription>
          Создайте личный или совместный бюджет, чтобы добавлять операции,
          лимиты и платежи в календарь.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onCreate}>
          <PlusIcon data-icon="inline-start" />
          Создать бюджет
        </Button>
      </CardContent>
    </Card>
  )
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  emphasis = false,
}: {
  title: string
  value: string
  description: string
  icon: typeof WalletIcon
  emphasis?: boolean
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border bg-background p-4",
        emphasis && "border-zinc-900 bg-zinc-950 text-white"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className={cn(
              "text-sm text-muted-foreground",
              emphasis && "text-white/60"
            )}
          >
            {title}
          </div>
          <div className="mt-2 break-words text-xl font-semibold tracking-normal sm:text-2xl">
            {value}
          </div>
        </div>
        <Icon
          className={cn(
            "shrink-0 text-muted-foreground",
            emphasis && "text-white/50"
          )}
        />
      </div>
      <p
        className={cn(
          "mt-4 text-sm text-muted-foreground",
          emphasis && "text-white/60"
        )}
      >
        {description}
      </p>
    </div>
  )
}

export function OverviewScreen({
  workspace,
  categories,
  transactions,
  budgets,
  liabilities,
  documents,
  permissions,
  onOpenDialog,
}: {
  workspace: Workspace | null
  categories: Category[]
  transactions: Transaction[]
  budgets: Budget[]
  liabilities: Liability[]
  documents: DocumentRecord[]
  permissions: WorkspacePermissions
  onOpenDialog: (dialog: DialogName) => void
}) {
  if (!workspace) {
    return <EmptyWorkspace onCreate={() => onOpenDialog("workspace")} />
  }

  const summary = summarizeWorkspace({ transactions, budgets, liabilities })
  const currency = workspace.currencyCode
  const cashflow = buildCashflow(transactions)
  const transactionDisabled = !permissions.createTransactions
  const budgetDisabled = !permissions.manageBudgets

  return (
    <FadeContent className="flex flex-col gap-5">
      <section className="grid gap-3 xl:grid-cols-[1.1fr_1.4fr]">
        <MetricCard
          title="Свободный остаток"
          value={formatMoney(summary.balance, currency)}
          description="Сумма после всех записанных доходов и расходов."
          icon={WalletIcon}
          emphasis
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            title="Расходы"
            value={formatMoney(summary.expense, currency)}
            description={`${transactions.length} операций в списке.`}
            icon={ArrowDownRightIcon}
          />
          <MetricCard
            title="Лимиты"
            value={`${summary.budgetCount}`}
            description="Категории с заданным бюджетом."
            icon={PiggyBankIcon}
          />
          <MetricCard
            title="Документы"
            value={`${documents.length}`}
            description="Чеки, договоры и файлы."
            icon={FileTextIcon}
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Доходы и расходы</CardTitle>
            <CardDescription>
              Последние 6 месяцев по выбранному бюджету.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {transactions.length ? (
              <ChartContainer config={chartConfig} className="h-[300px] w-full">
                <BarChart data={cashflow}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="income"
                    fill="var(--color-income)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="expense"
                    fill="var(--color-expense)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState
                title="Операций пока нет"
                description="Добавьте доход или расход, чтобы увидеть график."
                action="Добавить операцию"
                onAction={() => onOpenDialog("transaction")}
                disabled={transactionDisabled}
                disabledReason={readonlyReason}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Категории</CardTitle>
            <CardDescription>Готовые и добавленные вручную.</CardDescription>
          </CardHeader>
          <CardContent>
            {categories.length ? (
              <AnimatedList className="grid gap-2">
                {categories.slice(0, 8).map((category) => (
                  <div
                    key={category.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0">{category.icon}</span>
                      <span className="truncate font-medium">
                        {category.name}
                      </span>
                    </span>
                    <Badge
                      variant={category.custom ? "secondary" : "outline"}
                      className="shrink-0"
                    >
                      {category.custom ? "Своя" : "Шаблон"}
                    </Badge>
                  </div>
                ))}
              </AnimatedList>
            ) : (
              <EmptyState
                title="Категорий пока нет"
                description="Создайте лимит или операцию с новой категорией."
                action="Добавить бюджет"
                onAction={() => onOpenDialog("budget")}
                disabled={budgetDisabled}
                disabledReason={readonlyReason}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <TransactionsScreen
        workspace={workspace}
        categories={categories}
        transactions={transactions.slice(0, 5)}
        searchQuery=""
        compact
        permissions={permissions}
        onOpenDialog={onOpenDialog}
      />
    </FadeContent>
  )
}

export function TransactionsScreen({
  workspace,
  categories,
  transactions,
  searchQuery,
  compact = false,
  permissions,
  onOpenDialog,
}: {
  workspace: Workspace | null
  categories: Category[]
  transactions: Transaction[]
  searchQuery: string
  compact?: boolean
  permissions: WorkspacePermissions
  onOpenDialog: (dialog: DialogName) => void
}) {
  if (!workspace) {
    return <EmptyWorkspace onCreate={() => onOpenDialog("workspace")} />
  }

  const transactionDisabled = !permissions.createTransactions
  const filteredTransactions = transactions.filter((transaction) => {
    const category = getCategory(categories, transaction.categoryId)
    return matchesSearch(
      [
        transaction.title,
        transaction.account,
        category?.name ?? "",
        transaction.amount,
        transaction.date,
      ],
      searchQuery
    )
  })

  return (
    <section className="rounded-xl border bg-background">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-medium">
            {compact ? "Последние операции" : "Операции"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {searchQuery ? `Фильтр: ${searchQuery}` : "Доходы и расходы."}
          </p>
        </div>
        <div>
          <Button
            variant="outline"
            onClick={() => onOpenDialog("transaction")}
            disabled={transactionDisabled}
            title={transactionDisabled ? readonlyReason : undefined}
          >
            <PlusIcon data-icon="inline-start" />
            Операция
          </Button>
        </div>
      </div>
      <div className="p-4">
        <div className="overflow-x-auto rounded-lg border">
          <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow>
                <TableHead>Операция</TableHead>
                <TableHead className="hidden md:table-cell">Счет</TableHead>
                <TableHead>Категория</TableHead>
                <TableHead className="hidden sm:table-cell">Дата</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length ? (
                filteredTransactions.map((transaction) => {
                  const category = getCategory(categories, transaction.categoryId)
                  const signed =
                    transaction.type === "expense"
                      ? -transaction.amount
                      : transaction.amount

                  return (
                    <TableRow key={transaction.id}>
                      <TableCell className="min-w-[14rem] max-w-[18rem] font-medium">
                        <div className="flex min-w-0 items-center gap-2">
                          {transaction.type === "income" ? (
                            <ArrowUpRightIcon className="shrink-0 text-muted-foreground" />
                          ) : (
                            <ArrowDownRightIcon className="shrink-0 text-muted-foreground" />
                          )}
                          <span className="truncate">{transaction.title}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-[10rem] md:table-cell">
                        <span className="block truncate">
                          {transaction.account}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[12rem]">
                        <span className="block truncate">
                          {category?.icon} {category?.name ?? "Без категории"}
                        </span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {formatHumanDate(transaction.date)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(signed, workspace.currencyCode)}
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <EmptyInline
                      label={
                        searchQuery
                          ? "По фильтру ничего не найдено"
                          : "Операций нет"
                      }
                      action="Добавить"
                      onAction={() => onOpenDialog("transaction")}
                      disabled={transactionDisabled}
                      disabledReason={readonlyReason}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  )
}

export function BudgetsScreen({
  workspace,
  categories,
  transactions,
  budgets,
  searchQuery = "",
  permissions,
  onOpenDialog,
}: {
  workspace: Workspace | null
  categories: Category[]
  transactions: Transaction[]
  budgets: Budget[]
  searchQuery?: string
  permissions: WorkspacePermissions
  onOpenDialog: (dialog: DialogName) => void
}) {
  if (!workspace) {
    return <EmptyWorkspace onCreate={() => onOpenDialog("workspace")} />
  }

  const budgetDisabled = !permissions.manageBudgets
  const filteredBudgets = budgets.filter((budget) => {
    const category = getCategory(categories, budget.categoryId)
    return matchesSearch(
      [
        category?.name ?? "",
        budget.limit,
        budget.period,
        budgetPeriodLabels[budget.period],
        workspace.currencyCode,
      ],
      searchQuery
    )
  })

  return (
    <section className="rounded-xl border bg-background">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-medium">Бюджеты</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Лимиты по категориям.
          </p>
        </div>
        <div>
          <Button
            onClick={() => onOpenDialog("budget")}
            disabled={budgetDisabled}
            title={budgetDisabled ? readonlyReason : undefined}
          >
            <PlusIcon data-icon="inline-start" />
            Бюджет
          </Button>
        </div>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredBudgets.length ? (
          filteredBudgets.map((budget) => {
            const category = getCategory(categories, budget.categoryId)
            const currentPeriod = getCurrentBudgetPeriod(budget.period)
            const spent = transactions
              .filter(
                (transaction) =>
                  transaction.type === "expense" &&
                  transaction.categoryId === budget.categoryId &&
                  isDateInPeriod(transaction.date, currentPeriod)
              )
              .reduce((total, transaction) => total + transaction.amount, 0)
            const progress = budget.limit ? (spent / budget.limit) * 100 : 0

            return (
              <div key={budget.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      <span className="mr-1 shrink-0">{category?.icon}</span>
                      {category?.name ?? "Категория"}
                    </div>
                    <div className="mt-1 break-words text-sm text-muted-foreground">
                      {formatMoney(spent, workspace.currencyCode)} из{" "}
                      {formatMoney(budget.limit, workspace.currencyCode)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {budgetPeriodLabels[budget.period]} ·{" "}
                      {formatBudgetPeriodRange(currentPeriod)}
                    </div>
                  </div>
                  <Badge
                    variant={progress > 100 ? "destructive" : "outline"}
                    className="shrink-0"
                  >
                    {Math.round(progress)}%
                  </Badge>
                </div>
                <Progress value={Math.min(progress, 100)} className="mt-4" />
              </div>
            )
          })
        ) : (
          <EmptyState
            title={budgets.length ? "Бюджеты не найдены" : "Бюджеты еще не добавлены"}
            description={
              budgets.length
                ? "Измените строку поиска или добавьте новый лимит."
                : "Выберите шаблон категории и задайте лимит."
            }
            action="Добавить бюджет"
            onAction={() => onOpenDialog("budget")}
            disabled={budgetDisabled}
            disabledReason={readonlyReason}
          />
        )}
      </div>
    </section>
  )
}

export function CalendarScreen({
  workspace,
  categories,
  transactions,
  liabilities,
  searchQuery = "",
  selectedDate,
  onDateChange,
  permissions,
  onOpenDialog,
}: {
  workspace: Workspace | null
  categories: Category[]
  transactions: Transaction[]
  liabilities: Liability[]
  searchQuery?: string
  selectedDate: Date
  onDateChange: (date: Date) => void
  permissions: WorkspacePermissions
  onOpenDialog: (dialog: DialogName) => void
}) {
  if (!workspace) {
    return <EmptyWorkspace onCreate={() => onOpenDialog("workspace")} />
  }

  const transactionDisabled = !permissions.createTransactions
  const liabilityDisabled = !permissions.manageLiabilities
  const filteredTransactions = transactions.filter((transaction) => {
    const category = getCategory(categories, transaction.categoryId)

    return matchesSearch(
      [
        transaction.title,
        transaction.account,
        category?.name ?? "",
        transaction.amount,
        transaction.date,
      ],
      searchQuery
    )
  })
  const filteredLiabilities = liabilities.filter((liability) =>
    matchesSearch(
      [
        liability.title,
        liability.balance,
        liability.monthlyPayment,
        liability.rate,
        liability.nextPayment,
      ],
      searchQuery
    )
  )
  const selectedKey = formatDateKey(selectedDate)
  const allDayTransactions = transactions.filter(
    (transaction) => transaction.date === selectedKey
  )
  const allDayLiabilities = liabilities.filter(
    (liability) => liability.nextPayment === selectedKey
  )
  const dayTransactions = filteredTransactions.filter(
    (transaction) => transaction.date === selectedKey
  )
  const dayLiabilities = filteredLiabilities.filter(
    (liability) => liability.nextPayment === selectedKey
  )
  const dayIncome = dayTransactions
    .filter((transaction) => transaction.type === "income")
    .reduce((total, transaction) => total + transaction.amount, 0)
  const dayExpense = dayTransactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((total, transaction) => total + transaction.amount, 0)
  const dayPayments = dayLiabilities.reduce(
    (total, liability) => total + liability.monthlyPayment,
    0
  )
  const selectedLabel = selectedDate.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  const todayKey = formatDateKey(new Date())
  const upcomingPayments = [...filteredLiabilities]
    .filter((liability) => liability.nextPayment >= todayKey)
    .sort((left, right) => left.nextPayment.localeCompare(right.nextPayment))
    .slice(0, 4)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
      <section className="flex min-w-0 flex-col rounded-xl border bg-background p-4">
        <div className="mb-4 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-normal">
              План на месяц
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Отмечены дни с операциями и обязательными платежами.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              variant="outline"
              onClick={() => onOpenDialog("transaction")}
              disabled={transactionDisabled}
              title={transactionDisabled ? readonlyReason : undefined}
            >
              <CalendarPlusIcon data-icon="inline-start" />
              Операция
            </Button>
            <Button
              onClick={() => onOpenDialog("liability")}
              disabled={liabilityDisabled}
              title={liabilityDisabled ? readonlyReason : undefined}
            >
              <LandmarkIcon data-icon="inline-start" />
              Платеж
            </Button>
          </div>
        </div>
        <Calendar
          mode="single"
          ISOWeek
          selected={selectedDate}
          onSelect={(date) => date && onDateChange(date)}
          defaultMonth={selectedDate}
          className="mx-auto w-full max-w-[560px] p-0 [--cell-size:2.5rem]"
          formatters={{
            formatCaption: formatCalendarMonth,
            formatWeekdayName: formatCalendarWeekday,
          }}
          labels={{
            labelDayButton: labelCalendarDay,
            labelGrid: formatCalendarMonth,
            labelNext: () => "Следующий месяц",
            labelPrevious: () => "Предыдущий месяц",
          }}
          classNames={{
            root: "w-full",
            months: "w-full",
            month: "w-full",
            month_grid: "w-full border-separate border-spacing-1",
            weekdays: "grid grid-cols-7 gap-1",
            weekday:
              "flex h-8 items-center justify-center rounded-md text-xs font-medium uppercase text-muted-foreground",
            week: "mt-1 grid grid-cols-7 gap-1",
            day: "relative min-w-0 rounded-lg border bg-muted/20 transition-colors hover:bg-accent/70",
            day_button:
              "relative h-10 w-full rounded-lg text-sm sm:h-12 data-[selected-single=true]:shadow-sm",
          }}
          modifiers={{
            event: [
              ...filteredTransactions.map(
                (transaction) => new Date(`${transaction.date}T12:00:00`)
              ),
              ...filteredLiabilities.map(
                (liability) => new Date(`${liability.nextPayment}T12:00:00`)
              ),
            ],
          }}
          modifiersClassNames={{
            event:
              "after:absolute after:bottom-2 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-primary",
          }}
        />
      </section>

      <aside className="flex flex-col gap-4">
        <section className="rounded-xl border bg-background p-4">
          <p className="text-sm text-muted-foreground">Выбранная дата</p>
          <h2 className="mt-1 text-xl font-semibold tracking-normal">
            {selectedLabel}
          </h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs text-muted-foreground">Доход</div>
              <div className="mt-1 break-words text-sm font-medium tabular-nums">
                {formatMoney(dayIncome, workspace.currencyCode)}
              </div>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs text-muted-foreground">Расход</div>
              <div className="mt-1 break-words text-sm font-medium tabular-nums">
                {formatMoney(dayExpense, workspace.currencyCode)}
              </div>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <div className="text-xs text-muted-foreground">Платежи</div>
              <div className="mt-1 break-words text-sm font-medium tabular-nums">
                {formatMoney(dayPayments, workspace.currencyCode)}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border bg-background p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">Записи за день</h3>
              <p className="text-sm text-muted-foreground">
                Операции и платежи на выбранную дату.
              </p>
            </div>
            <Badge variant="outline">
              {dayTransactions.length + dayLiabilities.length}
            </Badge>
          </div>
          {dayTransactions.length || dayLiabilities.length ? (
            <AnimatedList className="grid gap-3">
              {dayTransactions.map((transaction) => {
                const category = getCategory(categories, transaction.categoryId)
                const signed =
                  transaction.type === "expense"
                    ? -transaction.amount
                    : transaction.amount
                return (
                  <div key={transaction.id} className="rounded-lg border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {transaction.title}
                        </div>
                        <div className="mt-1 truncate text-sm text-muted-foreground">
                          {category?.icon} {category?.name} ·{" "}
                          {transaction.account}
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "max-w-[9rem] shrink-0 truncate tabular-nums",
                          transaction.type === "income"
                            ? "text-emerald-700"
                            : "text-rose-700"
                        )}
                      >
                        {formatMoney(signed, workspace.currencyCode)}
                      </Badge>
                    </div>
                  </div>
                )
              })}
              {dayLiabilities.map((liability) => (
                <div key={liability.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {liability.title}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Плановый платеж · ставка {liability.rate}%
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="max-w-[9rem] shrink-0 truncate tabular-nums"
                    >
                      {formatMoney(
                        liability.monthlyPayment,
                        workspace.currencyCode
                      )}
                    </Badge>
                  </div>
                </div>
              ))}
            </AnimatedList>
          ) : allDayTransactions.length || allDayLiabilities.length ? (
            <div className="rounded-lg border border-dashed p-4">
              <div className="font-medium">Записи не найдены</div>
              <p className="mt-1 text-sm text-muted-foreground">
                На этот день есть записи, но они не совпадают со строкой поиска.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4">
              <div className="font-medium">На этот день записей нет</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Добавьте расход, доход или плановый платеж.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => onOpenDialog("transaction")}
                disabled={transactionDisabled}
                title={transactionDisabled ? readonlyReason : undefined}
              >
                <PlusIcon data-icon="inline-start" />
                Добавить операцию
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-background p-4">
          <h3 className="font-medium">Ближайшие платежи</h3>
          <div className="mt-3 grid gap-2">
            {upcomingPayments.length ? (
              upcomingPayments.map((liability) => (
                <div
                  key={liability.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {liability.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatHumanDate(liability.nextPayment)}
                    </div>
                  </div>
                  <div className="max-w-[9rem] shrink-0 truncate text-right text-sm font-medium tabular-nums">
                    {formatMoney(liability.monthlyPayment, workspace.currencyCode)}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                Ближайших платежей пока нет.
              </p>
            )}
          </div>
        </section>
      </aside>
    </div>
  )
}

export function FamilyScreen({
  user,
  workspace,
  searchQuery = "",
  permissions,
  onOpenDialog,
}: {
  user: User
  workspace: Workspace | null
  searchQuery?: string
  permissions: WorkspacePermissions
  onOpenDialog: (dialog: DialogName) => void
}) {
  if (!workspace) {
    return <EmptyWorkspace onCreate={() => onOpenDialog("workspace")} />
  }

  const currency = getCurrency(workspace.currencyCode)
  const currentMember =
    workspace.members.find(
      (member) => member.userId === user.id && member.status === "active"
    ) ?? null
  const inviteDisabled = !permissions.manageMembers
  const filteredMembers = workspace.members.filter((member) =>
    matchesSearch(
      [
        member.userId === user.id ? user.name : member.name,
        member.email,
        roleLabels[member.role],
        memberStatusLabels[member.status],
      ],
      searchQuery
    )
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="truncate">{workspace.name}</CardTitle>
        <CardDescription>
          {workspace.accessMode === "shared"
            ? "Совместный бюджет"
            : "Личный бюджет"}{" "}
          · {currency.region} {currency.code}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div className="rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheckIcon className="text-muted-foreground" />
              <span className="font-medium">Ваша роль</span>
              <Badge variant="outline">
                {currentMember ? roleLabels[currentMember.role] : "Нет доступа"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {currentMember
                ? roleDescriptions[currentMember.role]
                : "Активный участник выбранного бюджета не найден."}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="mb-3 font-medium">Права RBAC</div>
            <PermissionBadges permissions={permissions} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredMembers.length ? (
            filteredMembers.map((member) => (
              <div key={member.id} className="rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <Avatar className="shrink-0">
                    <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">
                      {member.userId === user.id ? user.name : member.name}
                    </div>
                    <div className="truncate text-sm text-muted-foreground">
                      {member.email}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {roleLabels[member.role]}
                  </Badge>
                </div>
                <div className="mt-3 text-sm text-muted-foreground">
                  {memberStatusLabels[member.status]}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {roleDescriptions[member.role]}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed p-4">
              <div className="font-medium">Участники не найдены</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Измените строку поиска или пригласите нового участника.
              </p>
            </div>
          )}
          <Magnet>
            <button
              type="button"
              className="flex min-h-32 w-full items-center justify-center rounded-lg border border-dashed bg-background text-left transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              onClick={() => onOpenDialog("invite")}
              disabled={inviteDisabled}
              title={inviteDisabled ? readonlyReason : undefined}
            >
              <div className="flex flex-col items-center gap-3">
                <Avatar>
                  <AvatarFallback>
                    <UserPlusIcon />
                  </AvatarFallback>
                </Avatar>
                <span className="font-medium">Пригласить</span>
              </div>
            </button>
          </Magnet>
        </div>
      </CardContent>
    </Card>
  )
}

export function LiabilitiesScreen({
  workspace,
  liabilities,
  searchQuery = "",
  permissions,
  onOpenDialog,
}: {
  workspace: Workspace | null
  liabilities: Liability[]
  searchQuery?: string
  permissions: WorkspacePermissions
  onOpenDialog: (dialog: DialogName) => void
}) {
  if (!workspace) {
    return <EmptyWorkspace onCreate={() => onOpenDialog("workspace")} />
  }

  const liabilityDisabled = !permissions.manageLiabilities
  const filteredLiabilities = liabilities.filter((liability) =>
    matchesSearch(
      [
        liability.title,
        liability.balance,
        liability.monthlyPayment,
        liability.rate,
        liability.nextPayment,
      ],
      searchQuery
    )
  )

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>Кредиты и обязательства</CardTitle>
        <CardDescription>Платежи попадают в календарь.</CardDescription>
        <CardAction className="col-start-1 row-start-3 justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
          <Button
            onClick={() => onOpenDialog("liability")}
            disabled={liabilityDisabled}
            title={liabilityDisabled ? readonlyReason : undefined}
          >
            <PlusIcon data-icon="inline-start" />
            Добавить
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {filteredLiabilities.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Остаток</TableHead>
                  <TableHead>Платеж</TableHead>
                  <TableHead>Ставка</TableHead>
                  <TableHead className="text-right">Дата</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLiabilities.map((liability) => (
                  <TableRow key={liability.id}>
                    <TableCell className="min-w-[14rem] max-w-[18rem] font-medium">
                      <span className="block truncate">{liability.title}</span>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(liability.balance, workspace.currencyCode)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatMoney(
                        liability.monthlyPayment,
                        workspace.currencyCode
                      )}
                    </TableCell>
                    <TableCell>{liability.rate}%</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatHumanDate(liability.nextPayment)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            title={liabilities.length ? "Обязательства не найдены" : "Обязательств нет"}
            description={
              liabilities.length
                ? "Измените строку поиска или добавьте новый платеж."
                : "Добавьте кредит, ипотеку или рассрочку."
            }
            action="Добавить обязательство"
            onAction={() => onOpenDialog("liability")}
            disabled={liabilityDisabled}
            disabledReason={readonlyReason}
          />
        )}
      </CardContent>
    </Card>
  )
}

export function DocumentsScreen({
  workspace,
  documents,
  searchQuery = "",
  permissions,
  onOpenDialog,
}: {
  workspace: Workspace | null
  documents: DocumentRecord[]
  searchQuery?: string
  permissions: WorkspacePermissions
  onOpenDialog: (dialog: DialogName) => void
}) {
  if (!workspace) {
    return <EmptyWorkspace onCreate={() => onOpenDialog("workspace")} />
  }

  const documentDisabled = !permissions.manageDocuments
  const filteredDocuments = documents.filter((document) =>
    matchesSearch(
      [
        document.title,
        document.fileName,
        document.linkedTo,
        document.fileSize ?? "",
        document.mimeType ?? "",
        documentStatusLabels[document.status],
      ],
      searchQuery
    )
  )

  return (
    <Card>
      <CardHeader className="gap-3">
        <CardTitle>Документы</CardTitle>
        <CardDescription>PDF, чеки и файлы по выбранному бюджету.</CardDescription>
        <CardAction className="col-start-1 row-start-3 justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
          <Button
            onClick={() => onOpenDialog("document")}
            disabled={documentDisabled}
            title={documentDisabled ? readonlyReason : undefined}
          >
            <PlusIcon data-icon="inline-start" />
            Загрузить
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {filteredDocuments.length ? (
          <div className="grid gap-3">
            {filteredDocuments.map((document) => (
              <div
                key={document.id}
                className="flex flex-col items-start gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{document.title}</div>
                  <div className="truncate text-sm text-muted-foreground">
                    {document.fileName} · {document.linkedTo} ·{" "}
                    {formatFileSize(document.fileSize)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline">
                    {documentStatusLabels[document.status]}
                  </Badge>
                  {document.fileData ? (
                    <a
                      className={cn(buttonVariants({ variant: "outline" }))}
                      href={document.fileData}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Открыть документ ${document.title}`}
                    >
                      <ExternalLinkIcon data-icon="inline-start" />
                      Открыть
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title={documents.length ? "Документы не найдены" : "Документов нет"}
            description={
              documents.length
                ? "Измените строку поиска или загрузите новый файл."
                : "Загрузите PDF, чек или договор."
            }
            action="Загрузить документ"
            onAction={() => onOpenDialog("document")}
            disabled={documentDisabled}
            disabledReason={readonlyReason}
          />
        )}
      </CardContent>
    </Card>
  )
}

export function SettingsScreen({
  user,
  workspace,
  currentMember,
  permissions,
  ssoConfig,
  onOpenDialog,
}: {
  user: User
  workspace: Workspace | null
  currentMember: Workspace["members"][number] | null
  permissions: WorkspacePermissions
  ssoConfig: SsoIdpConfig | null
  onOpenDialog: (dialog: DialogName) => void
}) {
  const ssoDisabled = !workspace || !permissions.manageSso

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Аккаунт</CardTitle>
            <CardDescription>Ваши данные для входа и текущая роль.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="min-w-0 rounded-lg border p-4">
              <div className="truncate font-medium">{user.name}</div>
              <div className="truncate text-sm text-muted-foreground">
                {user.email}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">
                  {currentMember ? roleLabels[currentMember.role] : "Без бюджета"}
                </Badge>
                {currentMember ? (
                  <Badge variant="secondary">
                    {memberStatusLabels[currentMember.status]}
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-3 font-medium">Права RBAC</div>
              <PermissionBadges permissions={permissions} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>SSO и IdP</CardTitle>
            <CardDescription>
              Вход через корпоративный провайдер для выбранного бюджета.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={ssoConfig?.enabled ? "secondary" : "outline"}>
                  {ssoConfig?.enabled ? "SSO включен" : "SSO отключен"}
                </Badge>
              </div>
              <div className="mt-3 min-w-0">
                <div className="truncate font-medium">
                  {ssoConfig?.providerName || "IdP не настроен"}
                </div>
                <div className="mt-1 truncate text-sm text-muted-foreground">
                  {ssoConfig?.issuerUrl || "Issuer URL не задан"}
                </div>
                <div className="mt-1 truncate text-sm text-muted-foreground">
                  Тип: {ssoConfig ? formatSsoProviderKind(ssoConfig.providerKind) : "не задан"}
                </div>
                <div className="mt-1 truncate text-sm text-muted-foreground">
                  Scopes: {ssoConfig?.scopes || "openid profile email"}
                </div>
                <div className="mt-1 truncate text-sm text-muted-foreground">
                  Домен: {ssoConfig?.domainHint || "не задан"}
                </div>
                <div className="mt-1 truncate text-sm text-muted-foreground">
                  RBAC claim: {ssoConfig?.roleClaim || "groups"}
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => onOpenDialog("sso")}
              disabled={ssoDisabled}
              title={
                !workspace
                  ? "Сначала создайте бюджет"
                  : ssoDisabled
                    ? readonlyReason
                    : undefined
              }
            >
              <ShieldCheckIcon data-icon="inline-start" />
              Настроить IdP
            </Button>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Выбранный бюджет</CardTitle>
          <CardDescription>
            {workspace
              ? "Участники и доступ находятся в разделе Семья."
              : "Бюджет еще не создан."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => onOpenDialog("workspace")}>
            <PlusIcon data-icon="inline-start" />
            {workspace ? "Создать еще один" : "Создать бюджет"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function EmptyState({
  title,
  description,
  action,
  onAction,
  disabled = false,
  disabledReason,
}: {
  title: string
  description: string
  action: string
  onAction: () => void
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <div className="flex min-h-44 flex-col items-start justify-center gap-3 rounded-lg border border-dashed p-6">
      <div>
        <div className="font-medium">{title}</div>
        <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      </div>
      <Button
        variant="outline"
        onClick={onAction}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
      >
        <PlusIcon data-icon="inline-start" />
        {action}
      </Button>
      {disabled && disabledReason ? (
        <div className="text-xs text-muted-foreground">{disabledReason}</div>
      ) : null}
    </div>
  )
}

function EmptyInline({
  label,
  action,
  onAction,
  disabled = false,
  disabledReason,
}: {
  label: string
  action: string
  onAction: () => void
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Button
        variant="outline"
        onClick={onAction}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
      >
        <PlusIcon data-icon="inline-start" />
        {action}
      </Button>
      {disabled && disabledReason ? (
        <span className="text-xs text-muted-foreground">{disabledReason}</span>
      ) : null}
    </div>
  )
}

function buildCashflow(transactions: Transaction[]) {
  const now = new Date()

  return Array.from({ length: 6 }, (_, index) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)
    const monthTransactions = transactions.filter((transaction) => {
      const date = new Date(`${transaction.date}T12:00:00`)
      return (
        date.getFullYear() === monthDate.getFullYear() &&
        date.getMonth() === monthDate.getMonth()
      )
    })

    return {
      month: monthDate.toLocaleDateString("ru-RU", { month: "short" }),
      income: monthTransactions
        .filter((transaction) => transaction.type === "income")
        .reduce((total, transaction) => total + transaction.amount, 0),
      expense: monthTransactions
        .filter((transaction) => transaction.type === "expense")
        .reduce((total, transaction) => total + transaction.amount, 0),
    }
  })
}
