import {
  type FormEvent,
  type ReactNode,
  useMemo,
  useState,
} from "react"
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  BanknoteIcon,
  BellIcon,
  Building2Icon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  FileTextIcon,
  HomeIcon,
  LandmarkIcon,
  LogOutIcon,
  MailIcon,
  PiggyBankIcon,
  PlusIcon,
  ReceiptTextIcon,
  SaveIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react"
import { toast, Toaster } from "sonner"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type View =
  | "overview"
  | "transactions"
  | "budgets"
  | "calendar"
  | "liabilities"
  | "documents"
  | "family"
  | "settings"

type Household = {
  name: string
  type: "personal" | "family"
  baseCurrency: string
}

type Transaction = {
  id: string
  title: string
  account: string
  category: string
  type: "income" | "expense"
  amount: number
  date: string
}

type Budget = {
  id: string
  category: string
  limit: number
}

type Member = {
  id: string
  email: string
  role: "admin" | "member" | "observer"
  status: "invited" | "active"
}

type Liability = {
  id: string
  title: string
  balance: number
  monthlyPayment: number
  rate: number
  nextPayment: string
}

type DocumentRecord = {
  id: string
  title: string
  fileName: string
  linkedTo: string
  status: "uploaded" | "checked"
  uploadedAt: string
}

type Session = {
  user: {
    name: string
    email: string
  }
  household: Household | null
  members: Member[]
  transactions: Transaction[]
  budgets: Budget[]
  liabilities: Liability[]
  documents: DocumentRecord[]
  notifications: string[]
}

type DialogKind =
  | "transaction"
  | "budget"
  | "invite"
  | "liability"
  | "document"
  | null

type IconComponent = typeof HomeIcon

const SESSION_STORAGE_KEY = "bestbudget.session.v3"
const LEGACY_STORAGE_KEYS = ["bestbudget.session.v2"]

const navItems: Array<{ view: View; label: string; icon: IconComponent }> = [
  { view: "overview", label: "Обзор", icon: HomeIcon },
  { view: "transactions", label: "Операции", icon: ReceiptTextIcon },
  { view: "budgets", label: "Бюджеты", icon: PiggyBankIcon },
  { view: "calendar", label: "Календарь", icon: CalendarDaysIcon },
  { view: "liabilities", label: "Кредиты", icon: LandmarkIcon },
  { view: "documents", label: "Документы", icon: FileTextIcon },
  { view: "family", label: "Семья", icon: UsersIcon },
  { view: "settings", label: "Настройки", icon: SettingsIcon },
]

const viewMeta: Record<View, { title: string; description: string }> = {
  overview: {
    title: "Обзор",
    description: "Сводка денег, лимитов, обязательств и ближайших платежей.",
  },
  transactions: {
    title: "Операции",
    description: "Доходы и расходы текущего пространства.",
  },
  budgets: {
    title: "Бюджеты",
    description: "Лимиты по категориям и контроль фактических расходов.",
  },
  calendar: {
    title: "Календарь",
    description: "Операции, платежи и события по датам.",
  },
  liabilities: {
    title: "Кредиты",
    description: "Ипотеки, рассрочки и регулярные платежи.",
  },
  documents: {
    title: "Документы",
    description: "PDF, чеки и файлы, связанные с бюджетом.",
  },
  family: {
    title: "Семья",
    description: "Участники пространства и приглашения.",
  },
  settings: {
    title: "Настройки",
    description: "Профиль, валюта и параметры личного или семейного бюджета.",
  },
}

const chartConfig = {
  income: {
    label: "Доход",
    color: "var(--chart-2)",
  },
  expense: {
    label: "Расход",
    color: "var(--chart-5)",
  },
} satisfies ChartConfig

function normalizeSession(value: unknown): Session | null {
  const parsed = value as Partial<Session> | null

  if (!parsed?.user?.email) {
    return null
  }

  return {
    user: {
      name: parsed.user.name || "Пользователь",
      email: parsed.user.email,
    },
    household: parsed.household ?? null,
    members: Array.isArray(parsed.members) ? parsed.members : [],
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    budgets: Array.isArray(parsed.budgets) ? parsed.budgets : [],
    liabilities: Array.isArray(parsed.liabilities) ? parsed.liabilities : [],
    documents: Array.isArray(parsed.documents) ? parsed.documents : [],
    notifications: Array.isArray(parsed.notifications)
      ? parsed.notifications
      : [],
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    return raw ? normalizeSession(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function saveSession(session: Session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY)
  LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key))
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")

  return `${year}-${month}-${day}`
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")

  return initials.toUpperCase() || "BB"
}

function getCurrency(session: Session) {
  return session.household?.baseCurrency || "RUB"
}

function formatMoney(value: number, currency = "RUB") {
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${Math.round(value).toLocaleString("ru-RU")} ${currency}`
  }
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function withNotification(session: Session, message: string): Session {
  return {
    ...session,
    notifications: [message, ...session.notifications].slice(0, 40),
  }
}

function summarize(session: Session) {
  const income = session.transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((total, transaction) => total + transaction.amount, 0)
  const expense = session.transactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((total, transaction) => total + transaction.amount, 0)
  const monthlyDebt = session.liabilities.reduce(
    (total, liability) => total + liability.monthlyPayment,
    0
  )
  const debtBalance = session.liabilities.reduce(
    (total, liability) => total + liability.balance,
    0
  )

  return {
    balance: income - expense,
    income,
    expense,
    monthlyDebt,
    debtBalance,
  }
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

function matchesSearch(values: Array<string | number>, query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return true
  }

  return values.join(" ").toLowerCase().includes(normalizedQuery)
}

function Panel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={cn("fluent-panel", className)}>{children}</section>
}

function PanelHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-6">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: IconComponent
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="flex min-h-48 flex-col items-start justify-center gap-4 rounded-lg border border-dashed border-border/80 bg-background/45 p-6">
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon />
      </div>
      <div className="max-w-xl">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Button onClick={onAction}>
        <PlusIcon data-icon="inline-start" />
        {actionLabel}
      </Button>
    </div>
  )
}

function RegisterScreen({
  onRegister,
}: {
  onRegister: (session: Session) => void
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextSession: Session = {
      user: {
        name: name.trim(),
        email: email.trim(),
      },
      household: null,
      members: [],
      transactions: [],
      budgets: [],
      liabilities: [],
      documents: [],
      notifications: ["Профиль создан. Настройте пространство в приложении."],
    }

    if (!nextSession.user.name || !nextSession.user.email) {
      return
    }

    onRegister(nextSession)
  }

  return (
    <main className="fluent-auth min-h-svh p-4 md:p-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-xl border bg-background/70 shadow-2xl shadow-slate-900/10 backdrop-blur-xl md:grid-cols-[0.9fr_1.1fr]">
        <section className="hidden min-h-[560px] flex-col justify-between bg-[linear-gradient(145deg,var(--primary),oklch(0.62_0.14_185))] p-8 text-primary-foreground md:flex">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-white/18 backdrop-blur">
              <BanknoteIcon />
            </div>
            <div>
              <div className="text-lg font-semibold">BestBudget</div>
              <div className="text-sm text-white/78">Личное пространство</div>
            </div>
          </div>
          <div className="max-w-sm">
            <h1 className="text-4xl font-semibold leading-tight">
              Деньги, семья и документы в одном рабочем окне.
            </h1>
            <p className="mt-4 text-sm leading-6 text-white/78">
              Сначала создается ваш профиль. Семья, валюта, бюджеты,
              приглашения и документы настраиваются после входа.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            {["Бюджеты", "Платежи", "PDF"].map((item) => (
              <div
                key={item}
                className="rounded-lg border border-white/18 bg-white/12 px-3 py-2"
              >
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="flex min-h-[560px] items-center justify-center p-5 md:p-10">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center gap-3 md:hidden">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <BanknoteIcon />
              </div>
              <div>
                <div className="font-semibold">BestBudget</div>
                <div className="text-sm text-muted-foreground">
                  Регистрация
                </div>
              </div>
            </div>
            <div className="mb-8">
              <h1 className="text-2xl font-semibold">Создать профиль</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Введите только свои данные. Пространство создается внутри
                приложения.
              </p>
            </div>

            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="name">Имя</FieldLabel>
                  <Input
                    id="name"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </Field>
                <Button type="submit" size="lg">
                  Зарегистрироваться
                </Button>
              </FieldGroup>
            </form>
          </div>
        </section>
      </div>
    </main>
  )
}

function AppNavigation({
  session,
  activeView,
  onNavigate,
  onLogout,
}: {
  session: Session
  activeView: View
  onNavigate: (view: View) => void
  onLogout: () => void
}) {
  const workspaceLabel = session.household
    ? session.household.type === "family"
      ? "Семейное пространство"
      : "Личное пространство"
    : "Пространство не настроено"

  return (
    <aside className="fluent-sidebar lg:sticky lg:top-0 lg:h-svh">
      <button
        className="fluent-brand"
        type="button"
        onClick={() => onNavigate("overview")}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BanknoteIcon />
        </span>
        <span className="min-w-0 text-left">
          <span className="block truncate font-semibold">BestBudget</span>
          <span className="block truncate text-xs text-muted-foreground">
            {workspaceLabel}
          </span>
        </span>
      </button>

      <nav className="fluent-nav-scroll flex gap-1 overflow-x-auto lg:flex-col lg:overflow-x-visible">
        {navItems.map((item) => (
          <button
            key={item.view}
            type="button"
            className={cn(
              "fluent-nav-button",
              item.view === activeView && "is-active"
            )}
            onClick={() => onNavigate(item.view)}
          >
            <item.icon />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="mt-auto hidden flex-col gap-2 lg:flex">
        <button
          type="button"
          className="fluent-user-button"
          onClick={() => onNavigate("settings")}
        >
          <Avatar className="size-9">
            <AvatarFallback>{getInitials(session.user.name)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 text-left">
            <span className="block truncate text-sm font-medium">
              {session.user.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {session.user.email}
            </span>
          </span>
        </button>
        <Button variant="ghost" className="justify-start" onClick={onLogout}>
          <LogOutIcon data-icon="inline-start" />
          Выйти
        </Button>
      </div>
    </aside>
  )
}

function CommandBar({
  session,
  searchQuery,
  onSearchChange,
  onOpenDialog,
  onOpenNotifications,
}: {
  session: Session
  searchQuery: string
  onSearchChange: (value: string) => void
  onOpenDialog: (kind: Exclude<DialogKind, null>) => void
  onOpenNotifications: () => void
}) {
  const workspaceStatus = session.household
    ? `${session.household.name} · ${session.household.baseCurrency}`
    : "Настройте пространство"

  return (
    <header className="fluent-command sticky top-0 z-20">
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-10 rounded-lg border-transparent bg-background/70 pl-9 shadow-none"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Поиск операций, бюджетов, документов"
        />
      </div>
      <Badge variant="outline" className="hidden max-w-[260px] md:inline-flex">
        <Building2Icon data-icon="inline-start" />
        <span className="truncate">{workspaceStatus}</span>
      </Badge>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Уведомления"
          onClick={onOpenNotifications}
        >
          <BellIcon />
        </Button>
        <Button
          variant="outline"
          className="hidden sm:inline-flex"
          onClick={() => onOpenDialog("invite")}
        >
          <UserPlusIcon data-icon="inline-start" />
          Пригласить
        </Button>
        <Button
          variant="outline"
          className="hidden md:inline-flex"
          onClick={() => onOpenDialog("budget")}
        >
          <PiggyBankIcon data-icon="inline-start" />
          Бюджет
        </Button>
        <Button onClick={() => onOpenDialog("transaction")}>
          <PlusIcon data-icon="inline-start" />
          Операция
        </Button>
      </div>
    </header>
  )
}

function MetricTile({
  title,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  title: string
  value: string
  hint: string
  icon: IconComponent
  tone?: "neutral" | "good" | "warn" | "bad"
}) {
  return (
    <Panel className="min-h-36">
      <div className="flex h-full flex-col justify-between gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <div className="mt-2 text-2xl font-semibold">{value}</div>
          </div>
          <div className={cn("fluent-metric-icon", `tone-${tone}`)}>
            <Icon />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
    </Panel>
  )
}

function SetupPrompt({ onSetup }: { onSetup: () => void }) {
  return (
    <Panel className="border-primary/25 bg-primary/5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <CheckCircle2Icon />
            Первый вход
          </div>
          <h2 className="mt-3 text-xl font-semibold">
            Создайте личное или семейное пространство
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            После этого станут доступны операции, бюджеты, кредиты, документы и
            приглашения участников.
          </p>
        </div>
        <Button onClick={onSetup}>
          <SettingsIcon data-icon="inline-start" />
          Настроить
        </Button>
      </div>
    </Panel>
  )
}

function OverviewScreen({
  session,
  onSetup,
  onOpenDialog,
  onNavigate,
}: {
  session: Session
  onSetup: () => void
  onOpenDialog: (kind: Exclude<DialogKind, null>) => void
  onNavigate: (view: View) => void
}) {
  const currency = getCurrency(session)
  const summary = summarize(session)
  const debtLoad =
    summary.income > 0 ? Math.round((summary.monthlyDebt / summary.income) * 100) : 0

  return (
    <div className="flex flex-col gap-5">
      {!session.household ? <SetupPrompt onSetup={onSetup} /> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          title="Свободный остаток"
          value={formatMoney(summary.balance, currency)}
          hint="Доходы минус расходы."
          icon={WalletIcon}
          tone={summary.balance >= 0 ? "good" : "bad"}
        />
        <MetricTile
          title="Расходы"
          value={formatMoney(summary.expense, currency)}
          hint={`${session.transactions.length} операций в пространстве.`}
          icon={ArrowDownRightIcon}
          tone="bad"
        />
        <MetricTile
          title="Долговая нагрузка"
          value={`${debtLoad}%`}
          hint={`${formatMoney(summary.monthlyDebt, currency)} в месяц.`}
          icon={LandmarkIcon}
          tone={debtLoad > 35 ? "warn" : "neutral"}
        />
        <MetricTile
          title="Документы"
          value={`${session.documents.length}`}
          hint="Файлы, привязанные к бюджету."
          icon={ShieldCheckIcon}
          tone="neutral"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_400px]">
        <CashflowPanel session={session} onOpenDialog={onOpenDialog} />
        <CalendarPanel session={session} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <TransactionsTable
          session={session}
          searchQuery=""
          limit={5}
          onAdd={() => onOpenDialog("transaction")}
        />
        <BudgetList
          session={session}
          onAdd={() => onOpenDialog("budget")}
          onNavigate={() => onNavigate("budgets")}
        />
      </div>
    </div>
  )
}

function CashflowPanel({
  session,
  onOpenDialog,
}: {
  session: Session
  onOpenDialog: (kind: Exclude<DialogKind, null>) => void
}) {
  const cashflow = buildCashflow(session.transactions)
  const hasData = session.transactions.length > 0

  return (
    <Panel className="min-h-[420px]">
      <Tabs defaultValue="cashflow" className="flex h-full flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold leading-6">
              Денежный поток
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Плановые и фактические движения за последние месяцы.
            </p>
          </div>
          <TabsList className="w-fit">
            <TabsTrigger value="cashflow">График</TabsTrigger>
            <TabsTrigger value="budgets">Лимиты</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="cashflow" className="mt-0 flex-1">
          {hasData ? (
            <ChartContainer config={chartConfig} className="h-[300px] w-full">
              <BarChart data={cashflow}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="income"
                  fill="var(--color-income)"
                  radius={[5, 5, 0, 0]}
                />
                <Bar
                  dataKey="expense"
                  fill="var(--color-expense)"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <EmptyState
              icon={ReceiptTextIcon}
              title="Операций пока нет"
              description="Добавьте первую операцию, и здесь появится график доходов и расходов."
              actionLabel="Добавить операцию"
              onAction={() => onOpenDialog("transaction")}
            />
          )}
        </TabsContent>

        <TabsContent value="budgets" className="mt-0">
          <BudgetList
            session={session}
            onAdd={() => onOpenDialog("budget")}
            compact
          />
        </TabsContent>
      </Tabs>
    </Panel>
  )
}

function TransactionsTable({
  session,
  searchQuery,
  onAdd,
  limit,
}: {
  session: Session
  searchQuery: string
  onAdd: () => void
  limit?: number
}) {
  const currency = getCurrency(session)
  const filteredTransactions = session.transactions
    .filter((transaction) =>
      matchesSearch(
        [
          transaction.title,
          transaction.account,
          transaction.category,
          transaction.amount,
          transaction.date,
        ],
        searchQuery
      )
    )
    .slice(0, limit)

  return (
    <Panel>
      <PanelHeader
        title={limit ? "Последние операции" : "Операции"}
        description={
          searchQuery
            ? `Фильтр: ${searchQuery}`
            : "Список доходов и расходов пространства."
        }
        action={
          <Button variant="outline" onClick={onAdd}>
            <PlusIcon data-icon="inline-start" />
            Операция
          </Button>
        }
      />
      <div className="mt-4 overflow-x-auto rounded-lg border bg-background/55">
        <Table>
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
            {filteredTransactions.length > 0 ? (
              filteredTransactions.map((transaction) => {
                const signedAmount =
                  transaction.type === "expense"
                    ? -transaction.amount
                    : transaction.amount

                return (
                  <TableRow key={transaction.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex size-7 items-center justify-center rounded-md",
                            transaction.type === "income"
                              ? "bg-emerald-500/10 text-emerald-700"
                              : "bg-rose-500/10 text-rose-700"
                          )}
                        >
                          {transaction.type === "income" ? (
                            <ArrowUpRightIcon />
                          ) : (
                            <ArrowDownRightIcon />
                          )}
                        </span>
                        <span>{transaction.title}</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {transaction.account}
                    </TableCell>
                    <TableCell>{transaction.category}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {formatDate(transaction.date)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium",
                        transaction.type === "income"
                          ? "text-emerald-700"
                          : "text-rose-700"
                      )}
                    >
                      {formatMoney(signedAmount, currency)}
                    </TableCell>
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      Операций нет
                    </span>
                    <Button variant="outline" onClick={onAdd}>
                      <PlusIcon data-icon="inline-start" />
                      Добавить
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Panel>
  )
}

function BudgetList({
  session,
  onAdd,
  onNavigate,
  compact = false,
}: {
  session: Session
  onAdd: () => void
  onNavigate?: () => void
  compact?: boolean
}) {
  const currency = getCurrency(session)

  return (
    <Panel className={cn(compact && "border-transparent bg-transparent p-0 shadow-none")}>
      {!compact ? (
        <PanelHeader
          title="Бюджеты"
          description="Факт расходов относительно лимитов."
          action={
            <div className="flex gap-2">
              {onNavigate ? (
                <Button variant="outline" onClick={onNavigate}>
                  Все
                </Button>
              ) : null}
              <Button variant="outline" onClick={onAdd}>
                <PlusIcon data-icon="inline-start" />
                Бюджет
              </Button>
            </div>
          }
        />
      ) : null}

      <div className={cn("flex flex-col gap-4", !compact && "mt-4")}>
        {session.budgets.length ? (
          session.budgets.map((budget) => {
            const spent = session.transactions
              .filter(
                (transaction) =>
                  transaction.type === "expense" &&
                  transaction.category.toLowerCase() ===
                    budget.category.toLowerCase()
              )
              .reduce((total, transaction) => total + transaction.amount, 0)
            const progress = budget.limit ? (spent / budget.limit) * 100 : 0

            return (
              <div
                key={budget.id}
                className="rounded-lg border bg-background/55 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">{budget.category}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {formatMoney(spent, currency)} из{" "}
                      {formatMoney(budget.limit, currency)}
                    </div>
                  </div>
                  <Badge variant={progress > 100 ? "destructive" : "outline"}>
                    {Math.round(progress)}%
                  </Badge>
                </div>
                <Progress value={Math.min(progress, 100)} className="mt-4" />
              </div>
            )
          })
        ) : (
          <EmptyState
            icon={PiggyBankIcon}
            title="Бюджеты еще не добавлены"
            description="Добавьте лимиты по категориям, чтобы видеть перерасходы."
            actionLabel="Добавить бюджет"
            onAction={onAdd}
          />
        )}
      </div>
    </Panel>
  )
}

function CalendarPanel({ session }: { session: Session }) {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const selectedKey = formatDateKey(selectedDate)
  const currency = getCurrency(session)
  const dayTransactions = session.transactions.filter(
    (transaction) => transaction.date === selectedKey
  )
  const dayLiabilities = session.liabilities.filter(
    (liability) => liability.nextPayment === selectedKey
  )

  return (
    <Panel>
      <PanelHeader
        title="Календарь"
        description={selectedDate.toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
      />
      <div className="mt-4 flex justify-center rounded-lg border bg-background/55 p-2">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => date && setSelectedDate(date)}
          defaultMonth={selectedDate}
          modifiers={{
            event: [
              ...session.transactions.map(
                (transaction) => new Date(`${transaction.date}T12:00:00`)
              ),
              ...session.liabilities.map(
                (liability) => new Date(`${liability.nextPayment}T12:00:00`)
              ),
            ],
          }}
          modifiersClassNames={{
            event:
              "after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
          }}
        />
      </div>
      <div className="mt-4 flex flex-col gap-3">
        {[...dayTransactions, ...dayLiabilities].length ? (
          <>
            {dayTransactions.map((transaction) => (
              <div
                key={transaction.id}
                className="flex items-start justify-between gap-3 rounded-lg border bg-background/55 p-3"
              >
                <div>
                  <div className="font-medium">{transaction.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {transaction.category} · {transaction.account}
                  </div>
                </div>
                <Badge variant="outline">
                  {formatMoney(transaction.amount, currency)}
                </Badge>
              </div>
            ))}
            {dayLiabilities.map((liability) => (
              <div
                key={liability.id}
                className="flex items-start justify-between gap-3 rounded-lg border bg-background/55 p-3"
              >
                <div>
                  <div className="font-medium">{liability.title}</div>
                  <div className="text-sm text-muted-foreground">
                    Плановый платеж
                  </div>
                </div>
                <Badge variant="outline">
                  {formatMoney(liability.monthlyPayment, currency)}
                </Badge>
              </div>
            ))}
          </>
        ) : (
          <p className="rounded-lg border bg-background/55 p-3 text-sm text-muted-foreground">
            На выбранную дату записей нет.
          </p>
        )}
      </div>
    </Panel>
  )
}

function TransactionsScreen({
  session,
  searchQuery,
  onOpenDialog,
  onSetup,
}: {
  session: Session
  searchQuery: string
  onOpenDialog: (kind: Exclude<DialogKind, null>) => void
  onSetup: () => void
}) {
  if (!session.household) {
    return <SetupPrompt onSetup={onSetup} />
  }

  return (
    <TransactionsTable
      session={session}
      searchQuery={searchQuery}
      onAdd={() => onOpenDialog("transaction")}
    />
  )
}

function BudgetsScreen({
  session,
  onOpenDialog,
  onSetup,
}: {
  session: Session
  onOpenDialog: (kind: Exclude<DialogKind, null>) => void
  onSetup: () => void
}) {
  if (!session.household) {
    return <SetupPrompt onSetup={onSetup} />
  }

  return (
    <BudgetList
      session={session}
      onAdd={() => onOpenDialog("budget")}
    />
  )
}

function CalendarScreen({
  session,
  onOpenDialog,
  onSetup,
}: {
  session: Session
  onOpenDialog: (kind: Exclude<DialogKind, null>) => void
  onSetup: () => void
}) {
  if (!session.household) {
    return <SetupPrompt onSetup={onSetup} />
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      <CalendarPanel session={session} />
      <TransactionsTable
        session={session}
        searchQuery=""
        onAdd={() => onOpenDialog("transaction")}
      />
    </div>
  )
}

function LiabilitiesScreen({
  session,
  searchQuery,
  onOpenDialog,
  onSetup,
}: {
  session: Session
  searchQuery: string
  onOpenDialog: (kind: Exclude<DialogKind, null>) => void
  onSetup: () => void
}) {
  const currency = getCurrency(session)
  const filteredLiabilities = session.liabilities.filter((liability) =>
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

  if (!session.household) {
    return <SetupPrompt onSetup={onSetup} />
  }

  return (
    <Panel>
      <PanelHeader
        title="Обязательства"
        description="Кредиты, ипотеки и регулярные платежи."
        action={
          <Button onClick={() => onOpenDialog("liability")}>
            <PlusIcon data-icon="inline-start" />
            Добавить
          </Button>
        }
      />
      {filteredLiabilities.length ? (
        <div className="mt-4 overflow-x-auto rounded-lg border bg-background/55">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Остаток</TableHead>
                <TableHead>Платеж</TableHead>
                <TableHead className="hidden sm:table-cell">Ставка</TableHead>
                <TableHead className="text-right">Дата</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLiabilities.map((liability) => (
                <TableRow key={liability.id}>
                  <TableCell className="font-medium">{liability.title}</TableCell>
                  <TableCell>{formatMoney(liability.balance, currency)}</TableCell>
                  <TableCell>
                    {formatMoney(liability.monthlyPayment, currency)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {liability.rate}%
                  </TableCell>
                  <TableCell className="text-right">
                    {formatDate(liability.nextPayment)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="mt-4">
          <EmptyState
            icon={LandmarkIcon}
            title="Обязательств нет"
            description="Добавьте ипотеку, кредит или рассрочку, чтобы видеть платежи в календаре."
            actionLabel="Добавить обязательство"
            onAction={() => onOpenDialog("liability")}
          />
        </div>
      )}
    </Panel>
  )
}

function DocumentsScreen({
  session,
  searchQuery,
  onOpenDialog,
  onSetup,
}: {
  session: Session
  searchQuery: string
  onOpenDialog: (kind: Exclude<DialogKind, null>) => void
  onSetup: () => void
}) {
  const filteredDocuments = session.documents.filter((document) =>
    matchesSearch(
      [document.title, document.fileName, document.linkedTo, document.uploadedAt],
      searchQuery
    )
  )

  if (!session.household) {
    return <SetupPrompt onSetup={onSetup} />
  }

  return (
    <Panel>
      <PanelHeader
        title="Документы"
        description="Файлы, загруженные в пространство."
        action={
          <Button onClick={() => onOpenDialog("document")}>
            <UploadIcon data-icon="inline-start" />
            Загрузить
          </Button>
        }
      />
      {filteredDocuments.length ? (
        <div className="mt-4 overflow-x-auto rounded-lg border bg-background/55">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Документ</TableHead>
                <TableHead className="hidden md:table-cell">Файл</TableHead>
                <TableHead>Связь</TableHead>
                <TableHead className="text-right">Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDocuments.map((document) => (
                <TableRow key={document.id}>
                  <TableCell className="font-medium">{document.title}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {document.fileName}
                  </TableCell>
                  <TableCell>{document.linkedTo}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline">
                      {document.status === "checked" ? "Проверен" : "Загружен"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="mt-4">
          <EmptyState
            icon={FileTextIcon}
            title="Документов нет"
            description="Загрузите PDF или чек, чтобы привязать его к платежу, кредиту или категории."
            actionLabel="Загрузить документ"
            onAction={() => onOpenDialog("document")}
          />
        </div>
      )}
    </Panel>
  )
}

function FamilyScreen({
  session,
  onOpenDialog,
  onSetup,
}: {
  session: Session
  onOpenDialog: (kind: Exclude<DialogKind, null>) => void
  onSetup: () => void
}) {
  if (!session.household) {
    return <SetupPrompt onSetup={onSetup} />
  }

  return (
    <Panel>
      <PanelHeader
        title="Участники"
        description={session.household.name}
        action={
          <Button onClick={() => onOpenDialog("invite")}>
            <UserPlusIcon data-icon="inline-start" />
            Пригласить
          </Button>
        }
      />
      <div className="mt-4 overflow-x-auto rounded-lg border bg-background/55">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead className="text-right">Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">{session.user.email}</TableCell>
              <TableCell>owner</TableCell>
              <TableCell className="text-right">
                <Badge variant="outline">active</Badge>
              </TableCell>
            </TableRow>
            {session.members.map((member) => (
              <TableRow key={member.id}>
                <TableCell className="font-medium">{member.email}</TableCell>
                <TableCell>{member.role}</TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline">{member.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  )
}

function SettingsScreen({
  session,
  onSaveProfile,
  onSaveHousehold,
  onReset,
}: {
  session: Session
  onSaveProfile: (user: Session["user"]) => void
  onSaveHousehold: (household: Household) => void
  onReset: () => void
}) {
  const [name, setName] = useState(session.user.name)
  const [email, setEmail] = useState(session.user.email)
  const [householdName, setHouseholdName] = useState(session.household?.name ?? "")
  const [baseCurrency, setBaseCurrency] = useState(
    session.household?.baseCurrency ?? "RUB"
  )
  const [householdType, setHouseholdType] = useState<Household["type"]>(
    session.household?.type ?? "family"
  )

  function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!name.trim() || !email.trim()) {
      return
    }

    onSaveProfile({
      name: name.trim(),
      email: email.trim(),
    })
  }

  function handleSaveHousehold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const household: Household = {
      name: householdName.trim(),
      type: householdType,
      baseCurrency: baseCurrency.trim().toUpperCase(),
    }

    if (!household.name || !household.baseCurrency) {
      return
    }

    onSaveHousehold(household)
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Panel>
        <PanelHeader
          title="Пространство"
          description="Семья, тип бюджета и базовая валюта настраиваются здесь."
        />
        <form className="mt-5" onSubmit={handleSaveHousehold}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="householdName">Название</FieldLabel>
              <Input
                id="householdName"
                value={householdName}
                onChange={(event) => setHouseholdName(event.target.value)}
                placeholder="Например: Семья Ивановых"
                required
              />
            </Field>
            <Field>
              <FieldLabel>Тип пространства</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={householdType === "family" ? "default" : "outline"}
                  onClick={() => setHouseholdType("family")}
                >
                  Семейное
                </Button>
                <Button
                  type="button"
                  variant={householdType === "personal" ? "default" : "outline"}
                  onClick={() => setHouseholdType("personal")}
                >
                  Личное
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="currency">Базовая валюта</FieldLabel>
              <Input
                id="currency"
                value={baseCurrency}
                maxLength={3}
                onChange={(event) => setBaseCurrency(event.target.value)}
                required
              />
              <FieldDescription>
                ISO-код, например RUB, USD или EUR.
              </FieldDescription>
            </Field>
            <Button type="submit">
              <SaveIcon data-icon="inline-start" />
              Сохранить пространство
            </Button>
          </FieldGroup>
        </form>
      </Panel>

      <div className="flex flex-col gap-5">
        <Panel>
          <PanelHeader title="Профиль" description="Данные владельца." />
          <form className="mt-5" onSubmit={handleSaveProfile}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="profileName">Имя</FieldLabel>
                <Input
                  id="profileName"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="profileEmail">Email</FieldLabel>
                <Input
                  id="profileEmail"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Button type="submit" variant="outline">
                <SaveIcon data-icon="inline-start" />
                Сохранить профиль
              </Button>
            </FieldGroup>
          </form>
        </Panel>

        <Panel>
          <PanelHeader
            title="Локальный профиль"
            description="Очистка текущей браузерной сессии."
          />
          <Button className="mt-5" variant="destructive" onClick={onReset}>
            <Trash2Icon data-icon="inline-start" />
            Очистить и выйти
          </Button>
        </Panel>
      </div>
    </div>
  )
}

function TransactionDialog({
  open,
  session,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  session: Session
  onOpenChange: (open: boolean) => void
  onSubmit: (transaction: Transaction) => void
}) {
  const [type, setType] = useState<Transaction["type"]>("expense")
  const [title, setTitle] = useState("")
  const [account, setAccount] = useState("")
  const [category, setCategory] = useState("")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(formatDateKey(new Date()))

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsedAmount = Number(amount)

    if (!title.trim() || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return
    }

    onSubmit({
      id: newId("transaction"),
      title: title.trim(),
      account: account.trim() || "Основной счет",
      category: category.trim() || "Без категории",
      type,
      amount: parsedAmount,
      date,
    })
    setType("expense")
    setTitle("")
    setAccount("")
    setCategory("")
    setAmount("")
    setDate(formatDateKey(new Date()))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Новая операция</DialogTitle>
          <DialogDescription>
            Запись попадет в таблицу, график и календарь.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel>Тип</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={type === "expense" ? "default" : "outline"}
                  onClick={() => setType("expense")}
                >
                  Расход
                </Button>
                <Button
                  type="button"
                  variant={type === "income" ? "default" : "outline"}
                  onClick={() => setType("income")}
                >
                  Доход
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="transactionTitle">Название</FieldLabel>
              <Input
                id="transactionTitle"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="transactionAmount">
                  Сумма, {getCurrency(session)}
                </FieldLabel>
                <Input
                  id="transactionAmount"
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="transactionDate">Дата</FieldLabel>
                <Input
                  id="transactionDate"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  required
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="transactionAccount">Счет</FieldLabel>
                <Input
                  id="transactionAccount"
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="transactionCategory">Категория</FieldLabel>
                <Input
                  id="transactionCategory"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </Field>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">Сохранить</Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BudgetDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (budget: Budget) => void
}) {
  const [category, setCategory] = useState("")
  const [limit, setLimit] = useState("")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsedLimit = Number(limit)

    if (!category.trim() || Number.isNaN(parsedLimit) || parsedLimit <= 0) {
      return
    }

    onSubmit({
      id: newId("budget"),
      category: category.trim(),
      limit: parsedLimit,
    })
    setCategory("")
    setLimit("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый бюджет</DialogTitle>
          <DialogDescription>
            Лимит применяется к расходам с такой же категорией.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="budgetCategory">Категория</FieldLabel>
              <Input
                id="budgetCategory"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="budgetLimit">Лимит</FieldLabel>
              <Input
                id="budgetLimit"
                type="number"
                min="1"
                value={limit}
                onChange={(event) => setLimit(event.target.value)}
                required
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">Сохранить</Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function InviteDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (member: Member) => void
}) {
  const [email, setEmail] = useState("")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!email.trim()) {
      return
    }

    onSubmit({
      id: newId("member"),
      email: email.trim(),
      role: "member",
      status: "invited",
    })
    setEmail("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Приглашение</DialogTitle>
          <DialogDescription>
            Участник появится в списке семьи со статусом invited.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="inviteEmail">Email</FieldLabel>
              <Input
                id="inviteEmail"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">
                <MailIcon data-icon="inline-start" />
                Отправить
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LiabilityDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (liability: Liability) => void
}) {
  const [title, setTitle] = useState("")
  const [balance, setBalance] = useState("")
  const [monthlyPayment, setMonthlyPayment] = useState("")
  const [rate, setRate] = useState("")
  const [nextPayment, setNextPayment] = useState(formatDateKey(new Date()))

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const parsedBalance = Number(balance)
    const parsedPayment = Number(monthlyPayment)
    const parsedRate = Number(rate)

    if (
      !title.trim() ||
      Number.isNaN(parsedBalance) ||
      Number.isNaN(parsedPayment) ||
      parsedBalance <= 0 ||
      parsedPayment <= 0
    ) {
      return
    }

    onSubmit({
      id: newId("liability"),
      title: title.trim(),
      balance: parsedBalance,
      monthlyPayment: parsedPayment,
      rate: Number.isNaN(parsedRate) ? 0 : parsedRate,
      nextPayment,
    })
    setTitle("")
    setBalance("")
    setMonthlyPayment("")
    setRate("")
    setNextPayment(formatDateKey(new Date()))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Новое обязательство</DialogTitle>
          <DialogDescription>
            Платеж появится в календаре и в сводке долговой нагрузки.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="liabilityTitle">Название</FieldLabel>
              <Input
                id="liabilityTitle"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="liabilityBalance">Остаток</FieldLabel>
                <Input
                  id="liabilityBalance"
                  type="number"
                  min="1"
                  value={balance}
                  onChange={(event) => setBalance(event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="liabilityPayment">Платеж</FieldLabel>
                <Input
                  id="liabilityPayment"
                  type="number"
                  min="1"
                  value={monthlyPayment}
                  onChange={(event) => setMonthlyPayment(event.target.value)}
                  required
                />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="liabilityRate">Ставка, %</FieldLabel>
                <Input
                  id="liabilityRate"
                  type="number"
                  min="0"
                  step="0.1"
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="liabilityDate">Следующий платеж</FieldLabel>
                <Input
                  id="liabilityDate"
                  type="date"
                  value={nextPayment}
                  onChange={(event) => setNextPayment(event.target.value)}
                  required
                />
              </Field>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">Сохранить</Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DocumentDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (document: DocumentRecord) => void
}) {
  const [title, setTitle] = useState("")
  const [fileName, setFileName] = useState("")
  const [linkedTo, setLinkedTo] = useState("")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!fileName) {
      return
    }

    onSubmit({
      id: newId("document"),
      title: title.trim() || fileName,
      fileName,
      linkedTo: linkedTo.trim() || "Не привязан",
      status: "uploaded",
      uploadedAt: formatDateKey(new Date()),
    })
    setTitle("")
    setFileName("")
    setLinkedTo("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Загрузка документа</DialogTitle>
          <DialogDescription>
            Файл сохраняется как запись в текущем пространстве.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="documentFile">PDF или изображение</FieldLabel>
              <Input
                id="documentFile"
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) =>
                  setFileName(event.currentTarget.files?.[0]?.name ?? "")
                }
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="documentTitle">Название</FieldLabel>
              <Input
                id="documentTitle"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="documentLinkedTo">Привязка</FieldLabel>
              <Input
                id="documentLinkedTo"
                value={linkedTo}
                onChange={(event) => setLinkedTo(event.target.value)}
                placeholder="Например: ипотека, коммунальные, чек"
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Отмена
              </Button>
              <Button type="submit">
                <UploadIcon data-icon="inline-start" />
                Загрузить
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function NotificationsSheet({
  open,
  session,
  onOpenChange,
}: {
  open: boolean
  session: Session
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="fluent-sheet">
        <SheetHeader>
          <SheetTitle>Уведомления</SheetTitle>
          <SheetDescription>Последние действия в приложении.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-4">
          {session.notifications.length ? (
            session.notifications.map((message, index) => (
              <div
                key={`${message}-${index}`}
                className="rounded-lg border bg-background/65 p-3 text-sm"
              >
                {message}
              </div>
            ))
          ) : (
            <p className="rounded-lg border bg-background/65 p-3 text-sm text-muted-foreground">
              Уведомлений пока нет.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Workspace({
  session,
  activeView,
  searchQuery,
  onSearchChange,
  onNavigate,
  onLogout,
  onOpenDialog,
  onOpenNotifications,
  onSaveProfile,
  onSaveHousehold,
  onReset,
}: {
  session: Session
  activeView: View
  searchQuery: string
  onSearchChange: (value: string) => void
  onNavigate: (view: View) => void
  onLogout: () => void
  onOpenDialog: (kind: Exclude<DialogKind, null>) => void
  onOpenNotifications: () => void
  onSaveProfile: (user: Session["user"]) => void
  onSaveHousehold: (household: Household) => void
  onReset: () => void
}) {
  const meta = viewMeta[activeView]
  const content = useMemo(() => {
    if (activeView === "overview") {
      return (
        <OverviewScreen
          session={session}
          onSetup={() => onNavigate("settings")}
          onOpenDialog={onOpenDialog}
          onNavigate={onNavigate}
        />
      )
    }

    if (activeView === "transactions") {
      return (
        <TransactionsScreen
          session={session}
          searchQuery={searchQuery}
          onOpenDialog={onOpenDialog}
          onSetup={() => onNavigate("settings")}
        />
      )
    }

    if (activeView === "budgets") {
      return (
        <BudgetsScreen
          session={session}
          onOpenDialog={onOpenDialog}
          onSetup={() => onNavigate("settings")}
        />
      )
    }

    if (activeView === "calendar") {
      return (
        <CalendarScreen
          session={session}
          onOpenDialog={onOpenDialog}
          onSetup={() => onNavigate("settings")}
        />
      )
    }

    if (activeView === "liabilities") {
      return (
        <LiabilitiesScreen
          session={session}
          searchQuery={searchQuery}
          onOpenDialog={onOpenDialog}
          onSetup={() => onNavigate("settings")}
        />
      )
    }

    if (activeView === "documents") {
      return (
        <DocumentsScreen
          session={session}
          searchQuery={searchQuery}
          onOpenDialog={onOpenDialog}
          onSetup={() => onNavigate("settings")}
        />
      )
    }

    if (activeView === "family") {
      return (
        <FamilyScreen
          session={session}
          onOpenDialog={onOpenDialog}
          onSetup={() => onNavigate("settings")}
        />
      )
    }

    return (
      <SettingsScreen
        session={session}
        onSaveProfile={onSaveProfile}
        onSaveHousehold={onSaveHousehold}
        onReset={onReset}
      />
    )
  }, [
    activeView,
    onNavigate,
    onOpenDialog,
    onReset,
    onSaveHousehold,
    onSaveProfile,
    searchQuery,
    session,
  ])

  return (
    <div className="fluent-root min-h-svh">
      <div className="grid min-h-svh lg:grid-cols-[280px_minmax(0,1fr)]">
        <AppNavigation
          session={session}
          activeView={activeView}
          onNavigate={onNavigate}
          onLogout={onLogout}
        />
        <div className="min-w-0 overflow-hidden">
          <CommandBar
            session={session}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            onOpenDialog={onOpenDialog}
            onOpenNotifications={onOpenNotifications}
          />
          <main className="flex min-w-0 flex-col gap-5 p-4 md:p-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold">{meta.title}</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">
                {meta.description}
              </p>
            </div>
            {content}
          </main>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [activeView, setActiveView] = useState<View>("overview")
  const [searchQuery, setSearchQuery] = useState("")
  const [openDialog, setOpenDialog] = useState<DialogKind>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  function commit(nextSession: Session, message?: string) {
    saveSession(nextSession)
    setSession(nextSession)

    if (message) {
      toast.success(message)
    }
  }

  function handleRegister(nextSession: Session) {
    commit(nextSession, "Профиль создан")
    setActiveView("settings")
  }

  function handleLogout() {
    clearSession()
    setSession(null)
    setActiveView("overview")
    setSearchQuery("")
    toast.info("Вы вышли из локального профиля")
  }

  function handleReset() {
    clearSession()
    setSession(null)
    setActiveView("overview")
    setSearchQuery("")
    toast.info("Локальные данные очищены")
  }

  function handleOpenDialog(kind: Exclude<DialogKind, null>) {
    if (!session?.household) {
      setActiveView("settings")
      toast.warning("Сначала создайте пространство в настройках")
      return
    }

    setOpenDialog(kind)
  }

  if (!session) {
    return (
      <TooltipProvider>
        <RegisterScreen onRegister={handleRegister} />
        <Toaster position="bottom-right" richColors />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <Workspace
        session={session}
        activeView={activeView}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onNavigate={setActiveView}
        onLogout={handleLogout}
        onOpenDialog={handleOpenDialog}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onSaveProfile={(user) => {
          const message = "Профиль сохранен"
          commit(withNotification({ ...session, user }, message), message)
        }}
        onSaveHousehold={(household) => {
          const message = "Пространство сохранено"
          commit(
            withNotification(
              {
                ...session,
                household,
              },
              message
            ),
            message
          )
        }}
        onReset={handleReset}
      />

      <TransactionDialog
        open={openDialog === "transaction"}
        session={session}
        onOpenChange={(open) => setOpenDialog(open ? "transaction" : null)}
        onSubmit={(transaction) => {
          const message = `Операция сохранена: ${transaction.title}`
          commit(
            withNotification(
              {
                ...session,
                transactions: [transaction, ...session.transactions],
              },
              message
            ),
            "Операция сохранена"
          )
          setOpenDialog(null)
          setActiveView("transactions")
        }}
      />
      <BudgetDialog
        open={openDialog === "budget"}
        onOpenChange={(open) => setOpenDialog(open ? "budget" : null)}
        onSubmit={(budget) => {
          const message = `Бюджет добавлен: ${budget.category}`
          commit(
            withNotification(
              {
                ...session,
                budgets: [budget, ...session.budgets],
              },
              message
            ),
            "Бюджет добавлен"
          )
          setOpenDialog(null)
          setActiveView("budgets")
        }}
      />
      <InviteDialog
        open={openDialog === "invite"}
        onOpenChange={(open) => setOpenDialog(open ? "invite" : null)}
        onSubmit={(member) => {
          const message = `Приглашение отправлено: ${member.email}`
          commit(
            withNotification(
              {
                ...session,
                members: [member, ...session.members],
              },
              message
            ),
            "Приглашение отправлено"
          )
          setOpenDialog(null)
          setActiveView("family")
        }}
      />
      <LiabilityDialog
        open={openDialog === "liability"}
        onOpenChange={(open) => setOpenDialog(open ? "liability" : null)}
        onSubmit={(liability) => {
          const message = `Обязательство добавлено: ${liability.title}`
          commit(
            withNotification(
              {
                ...session,
                liabilities: [liability, ...session.liabilities],
              },
              message
            ),
            "Обязательство добавлено"
          )
          setOpenDialog(null)
          setActiveView("liabilities")
        }}
      />
      <DocumentDialog
        open={openDialog === "document"}
        onOpenChange={(open) => setOpenDialog(open ? "document" : null)}
        onSubmit={(document) => {
          const message = `Документ загружен: ${document.title}`
          commit(
            withNotification(
              {
                ...session,
                documents: [document, ...session.documents],
              },
              message
            ),
            "Документ загружен"
          )
          setOpenDialog(null)
          setActiveView("documents")
        }}
      />
      <NotificationsSheet
        open={notificationsOpen}
        session={session}
        onOpenChange={setNotificationsOpen}
      />
      <Toaster position="bottom-right" richColors />
    </TooltipProvider>
  )
}
