import { type FormEvent, useState } from "react"
import {
  BanknoteIcon,
  BellIcon,
  CalendarDaysIcon,
  CreditCardIcon,
  FileTextIcon,
  HomeIcon,
  LandmarkIcon,
  LogOutIcon,
  PiggyBankIcon,
  PlusIcon,
  ReceiptTextIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UploadIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
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

type Session = {
  user: {
    name: string
    email: string
  }
  household: Household | null
  members: Member[]
  transactions: Transaction[]
  budgets: Budget[]
  notifications: string[]
}

const SESSION_STORAGE_KEY = "bestbudget.session.v2"

const navItems: Array<{ view: View; label: string; icon: typeof HomeIcon }> = [
  { view: "overview", label: "Обзор", icon: HomeIcon },
  { view: "transactions", label: "Операции", icon: ReceiptTextIcon },
  { view: "budgets", label: "Бюджеты", icon: PiggyBankIcon },
  { view: "calendar", label: "Календарь", icon: CalendarDaysIcon },
  { view: "liabilities", label: "Кредиты", icon: LandmarkIcon },
  { view: "documents", label: "Документы", icon: FileTextIcon },
  { view: "family", label: "Семья", icon: UsersIcon },
  { view: "settings", label: "Настройки", icon: SettingsIcon },
]

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

const monthLabels = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн"]

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function saveSession(session: Session) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
}

function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY)
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
  const initials = parts.slice(0, 2).map((part) => part[0]).join("")

  return initials.toUpperCase() || "BB"
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

function getCurrency(session: Session) {
  return session.household?.baseCurrency || "RUB"
}

function buildCashflow(transactions: Transaction[]) {
  return monthLabels.map((month, index) => {
    const monthTransactions = transactions.filter((transaction) => {
      const date = new Date(`${transaction.date}T12:00:00`)
      return date.getMonth() === index
    })

    return {
      month,
      income: monthTransactions
        .filter((transaction) => transaction.type === "income")
        .reduce((total, transaction) => total + transaction.amount, 0),
      expense: monthTransactions
        .filter((transaction) => transaction.type === "expense")
        .reduce((total, transaction) => total + transaction.amount, 0),
    }
  })
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

    const session: Session = {
      user: {
        name: name.trim(),
        email: email.trim(),
      },
      household: null,
      members: [],
      transactions: [],
      budgets: [],
      notifications: ["Профиль создан. Настройте пространство в разделе настроек."],
    }

    if (!session.user.name || !session.user.email) {
      return
    }

    saveSession(session)
    onRegister(session)
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Регистрация</CardTitle>
          <CardDescription>
            Создайте профиль. Пространство, семья, бюджеты и приглашения
            настраиваются внутри приложения.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="name">Ваше имя</FieldLabel>
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
        </CardContent>
      </Card>
    </main>
  )
}

function AppSidebar({
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
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={() => onNavigate("overview")}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <BanknoteIcon />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">BestBudget</span>
                <span className="truncate text-xs text-muted-foreground">
                  {workspaceLabel}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Навигация</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.view}>
                  <SidebarMenuButton
                    isActive={item.view === activeView}
                    tooltip={item.label}
                    onClick={() => onNavigate(item.view)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => onNavigate("settings")}>
              <Avatar className="size-8">
                <AvatarFallback>{getInitials(session.user.name)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{session.user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  owner
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onLogout}>
              <LogOutIcon />
              <span>Выйти</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

function KpiGrid({ session }: { session: Session }) {
  const currency = getCurrency(session)
  const income = session.transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((total, transaction) => total + transaction.amount, 0)
  const expense = session.transactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((total, transaction) => total + transaction.amount, 0)

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader>
          <CardDescription>Свободный остаток</CardDescription>
          <CardTitle>{formatMoney(income - expense, currency)}</CardTitle>
          <CardAction>
            <Badge variant="outline">текущий</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Рассчитывается из добавленных операций.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Расходы месяца</CardDescription>
          <CardTitle>{formatMoney(expense, currency)}</CardTitle>
          <CardAction>
            <CreditCardIcon className="text-muted-foreground" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <Progress value={session.budgets.length ? 30 : 0} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Долговая нагрузка</CardDescription>
          <CardTitle>0%</CardTitle>
          <CardAction>
            <LandmarkIcon className="text-muted-foreground" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Кредиты и ипотеки пока не добавлены.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>PDF-документы</CardDescription>
          <CardTitle>0</CardTitle>
          <CardAction>
            <ShieldCheckIcon className="text-muted-foreground" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Документы появятся после загрузки.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function EmptyWorkspaceCard({ onSetup }: { onSetup: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Пространство еще не настроено</CardTitle>
        <CardDescription>
          Создайте личное или семейное пространство, затем добавляйте счета,
          бюджеты, приглашения и операции.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onSetup}>
          <SettingsIcon data-icon="inline-start" />
          Настроить пространство
        </Button>
      </CardContent>
    </Card>
  )
}

function OverviewScreen({
  session,
  onSetup,
}: {
  session: Session
  onSetup: () => void
}) {
  const cashflow = buildCashflow(session.transactions)
  const selectedDate = new Date()

  return (
    <div className="flex flex-col gap-4">
      {!session.household ? <EmptyWorkspaceCard onSetup={onSetup} /> : null}
      <KpiGrid session={session} />
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-[520px] rounded-lg border"
      >
        <ResizablePanel defaultSize={68} minSize={50}>
          <div className="flex h-full flex-col gap-4 p-4">
            <Tabs defaultValue="cashflow" className="flex flex-1 flex-col">
              <TabsList className="w-fit">
                <TabsTrigger value="cashflow">Cashflow</TabsTrigger>
                <TabsTrigger value="budgets">Бюджеты</TabsTrigger>
                <TabsTrigger value="transactions">Операции</TabsTrigger>
              </TabsList>
              <TabsContent value="cashflow" className="flex-1">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>Доходы и расходы</CardTitle>
                    <CardDescription>
                      График строится по вашим операциям.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={chartConfig}
                      className="h-[300px] w-full"
                    >
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
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="budgets">
                <BudgetList session={session} />
              </TabsContent>
              <TabsContent value="transactions">
                <TransactionsTable session={session} />
              </TabsContent>
            </Tabs>
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={32} minSize={26}>
          <aside className="flex h-full flex-col gap-4 p-4">
            <CalendarPanel
              session={session}
              initialDate={selectedDate}
              compact
            />
          </aside>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function TransactionsTable({ session }: { session: Session }) {
  const currency = getCurrency(session)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Операции</CardTitle>
        <CardDescription>Доходы и расходы текущего пространства.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Операция</TableHead>
              <TableHead>Счет</TableHead>
              <TableHead>Категория</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead className="text-right">Сумма</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {session.transactions.length > 0 ? (
              session.transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell className="font-medium">{transaction.title}</TableCell>
                  <TableCell>{transaction.account}</TableCell>
                  <TableCell>{transaction.category}</TableCell>
                  <TableCell>{transaction.date}</TableCell>
                  <TableCell className="text-right">
                    {formatMoney(
                      transaction.type === "expense"
                        ? -transaction.amount
                        : transaction.amount,
                      currency
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Нет операций
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function BudgetList({ session }: { session: Session }) {
  const currency = getCurrency(session)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Бюджеты</CardTitle>
        <CardDescription>Лимиты по категориям.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
              <div key={budget.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="font-medium">{budget.category}</span>
                  <span className="text-muted-foreground">
                    {formatMoney(spent, currency)} /{" "}
                    {formatMoney(budget.limit, currency)}
                  </span>
                </div>
                <Progress value={Math.min(progress, 100)} />
              </div>
            )
          })
        ) : (
          <p className="text-sm text-muted-foreground">
            Бюджеты еще не добавлены.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function CalendarPanel({
  session,
  initialDate,
  compact = false,
}: {
  session: Session
  initialDate: Date
  compact?: boolean
}) {
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const selectedKey = formatDateKey(selectedDate)
  const selectedLabel = selectedDate.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  const dayItems = session.transactions.filter(
    (transaction) => transaction.date === selectedKey
  )

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Календарь</CardTitle>
          <CardDescription>Выбрано: {selectedLabel}</CardDescription>
        </CardHeader>
        <CardContent>
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => date && setSelectedDate(date)}
            defaultMonth={selectedDate}
            modifiers={{
              booked: session.transactions.map(
                (transaction) => new Date(`${transaction.date}T12:00:00`)
              ),
            }}
            modifiersClassNames={{
              booked:
                "after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
            }}
          />
        </CardContent>
      </Card>
      <Card className={compact ? "flex-1" : ""}>
        <CardHeader>
          <CardTitle>Правая панель даты</CardTitle>
          <CardDescription>Операции, платежи и напоминания.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {dayItems.length > 0 ? (
            dayItems.map((item) => (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex flex-col gap-1">
                  <div className="font-medium">{item.title}</div>
                  <div className="text-sm text-muted-foreground">
                    {item.category} · {item.type}
                  </div>
                </div>
                <Badge variant="outline">
                  {formatMoney(item.amount, getCurrency(session))}
                </Badge>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              На выбранную дату нет операций или напоминаний.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function SettingsScreen({
  session,
  onSave,
}: {
  session: Session
  onSave: (session: Session) => void
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
    onSave({
      ...session,
      user: {
        name: name.trim(),
        email: email.trim(),
      },
      notifications: ["Профиль обновлен.", ...session.notifications],
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

    onSave({
      ...session,
      household,
      notifications: ["Пространство сохранено.", ...session.notifications],
    })
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Профиль</CardTitle>
          <CardDescription>Данные пользователя.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveProfile}>
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
              <Button type="submit">Сохранить профиль</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Пространство</CardTitle>
          <CardDescription>
            Здесь настраивается личный или семейный бюджет.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveHousehold}>
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
                <FieldLabel>Тип</FieldLabel>
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
                <FieldDescription>Настраивается внутри приложения.</FieldDescription>
              </Field>
              <Button type="submit">Сохранить пространство</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function FamilyScreen({
  session,
  onSave,
  onSetup,
}: {
  session: Session
  onSave: (session: Session) => void
  onSetup: () => void
}) {
  const [email, setEmail] = useState("")

  function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invitedEmail = email.trim()

    if (!invitedEmail) {
      return
    }

    onSave({
      ...session,
      members: [
        ...session.members,
        {
          id: newId("member"),
          email: invitedEmail,
          role: "member",
          status: "invited",
        },
      ],
      notifications: [`Приглашение отправлено: ${invitedEmail}`, ...session.notifications],
    })
    setEmail("")
  }

  if (!session.household) {
    return <EmptyWorkspaceCard onSetup={onSetup} />
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle>Участники</CardTitle>
          <CardDescription>{session.household.name}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Статус</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{session.user.email}</TableCell>
                <TableCell>owner</TableCell>
                <TableCell>active</TableCell>
              </TableRow>
              {session.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>{member.role}</TableCell>
                  <TableCell>{member.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Приглашение</CardTitle>
          <CardDescription>Добавьте участника по email.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite}>
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
              <Button type="submit">
                <UserPlusIcon data-icon="inline-start" />
                Отправить приглашение
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function BudgetScreen({
  session,
  onSave,
  onSetup,
}: {
  session: Session
  onSave: (session: Session) => void
  onSetup: () => void
}) {
  const [category, setCategory] = useState("")
  const [limit, setLimit] = useState("")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsedLimit = Number(limit)

    if (!category.trim() || Number.isNaN(parsedLimit) || parsedLimit <= 0) {
      return
    }

    onSave({
      ...session,
      budgets: [
        ...session.budgets,
        {
          id: newId("budget"),
          category: category.trim(),
          limit: parsedLimit,
        },
      ],
      notifications: [`Бюджет добавлен: ${category.trim()}`, ...session.notifications],
    })
    setCategory("")
    setLimit("")
  }

  if (!session.household) {
    return <EmptyWorkspaceCard onSetup={onSetup} />
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <BudgetList session={session} />
      <Card>
        <CardHeader>
          <CardTitle>Новый бюджет</CardTitle>
          <CardDescription>Лимит по категории.</CardDescription>
        </CardHeader>
        <CardContent>
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
              <Button type="submit">Добавить бюджет</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function AddTransactionDialog({
  open,
  session,
  onOpenChange,
  onSave,
}: {
  open: boolean
  session: Session
  onOpenChange: (open: boolean) => void
  onSave: (transaction: Transaction) => void
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

    onSave({
      id: newId("transaction"),
      title: title.trim(),
      account: account.trim() || "Основной счет",
      category: category.trim() || "Без категории",
      type,
      amount: parsedAmount,
      date,
    })
    setTitle("")
    setAccount("")
    setCategory("")
    setAmount("")
    setDate(formatDateKey(new Date()))
    setType("expense")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая операция</DialogTitle>
          <DialogDescription>
            Операция сохранится локально в текущем прототипе.
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
            <div className="grid gap-3 md:grid-cols-2">
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
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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

function SimpleModuleScreen({
  title,
  description,
  action,
  icon: Icon,
  onAction,
}: {
  title: string
  description: string
  action: string
  icon: typeof FileTextIcon
  onAction: () => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={onAction}>
          <Icon data-icon="inline-start" />
          {action}
        </Button>
      </CardContent>
    </Card>
  )
}

function AppContent({
  session,
  activeView,
  onNavigate,
  onSave,
  onAddTransactionClick,
  onOpenNotifications,
}: {
  session: Session
  activeView: View
  onNavigate: (view: View) => void
  onSave: (session: Session) => void
  onAddTransactionClick: () => void
  onOpenNotifications: () => void
}) {
  const viewTitle =
    navItems.find((item) => item.view === activeView)?.label ?? "Обзор"
  const subtitle = session.household
    ? `${session.household.name} · ${session.household.baseCurrency}`
    : "Сначала настройте пространство в разделе настроек"

  function addNotification(message: string) {
    onSave({
      ...session,
      notifications: [message, ...session.notifications],
    })
  }

  return (
    <SidebarInset>
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-5" />
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="relative hidden w-full max-w-sm md:block">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Поиск операций, счетов, PDF" />
          </div>
          <Badge variant="outline">{subtitle}</Badge>
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Уведомления"
          onClick={onOpenNotifications}
        >
          <BellIcon />
        </Button>
        <Button onClick={onAddTransactionClick}>
          <PlusIcon data-icon="inline-start" />
          Операция
        </Button>
      </header>

      <ScrollArea className="h-[calc(100svh-3.5rem)]">
        <main className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-normal">
              {viewTitle}
            </h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>

          {activeView === "overview" ? (
            <OverviewScreen
              session={session}
              onSetup={() => onNavigate("settings")}
            />
          ) : null}
          {activeView === "transactions" ? (
            <TransactionsTable session={session} />
          ) : null}
          {activeView === "budgets" ? (
            <BudgetScreen
              session={session}
              onSave={onSave}
              onSetup={() => onNavigate("settings")}
            />
          ) : null}
          {activeView === "calendar" ? (
            <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
              <CalendarPanel session={session} initialDate={new Date()} />
            </div>
          ) : null}
          {activeView === "family" ? (
            <FamilyScreen
              session={session}
              onSave={onSave}
              onSetup={() => onNavigate("settings")}
            />
          ) : null}
          {activeView === "settings" ? (
            <SettingsScreen session={session} onSave={onSave} />
          ) : null}
          {activeView === "liabilities" ? (
            <SimpleModuleScreen
              title="Кредиты и ипотеки"
              description="Ручной контур обязательств будет расширяться графиками и PDF."
              action="Добавить обязательство"
              icon={LandmarkIcon}
              onAction={() => addNotification("Контур кредитов отмечен к настройке.")}
            />
          ) : null}
          {activeView === "documents" ? (
            <SimpleModuleScreen
              title="Документы"
              description="Загрузка PDF будет связана с кредитами, счетами и операциями."
              action="Загрузить PDF"
              icon={UploadIcon}
              onAction={() => addNotification("Загрузка PDF отмечена к настройке.")}
            />
          ) : null}
        </main>
      </ScrollArea>
    </SidebarInset>
  )
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [activeView, setActiveView] = useState<View>("overview")
  const [operationDialogOpen, setOperationDialogOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  function persist(nextSession: Session) {
    saveSession(nextSession)
    setSession(nextSession)
  }

  function handleLogout() {
    clearSession()
    setSession(null)
    setActiveView("overview")
  }

  if (!session) {
    return (
      <TooltipProvider>
        <RegisterScreen onRegister={setSession} />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          session={session}
          activeView={activeView}
          onNavigate={setActiveView}
          onLogout={handleLogout}
        />
        <AppContent
          session={session}
          activeView={activeView}
          onNavigate={setActiveView}
          onSave={persist}
          onAddTransactionClick={() => setOperationDialogOpen(true)}
          onOpenNotifications={() => setNotificationsOpen(true)}
        />
        <AddTransactionDialog
          open={operationDialogOpen}
          session={session}
          onOpenChange={setOperationDialogOpen}
          onSave={(transaction) => {
            persist({
              ...session,
              transactions: [transaction, ...session.transactions],
              notifications: [
                `Операция сохранена: ${transaction.title}`,
                ...session.notifications,
              ],
            })
            setOperationDialogOpen(false)
          }}
        />
        <Sheet open={notificationsOpen} onOpenChange={setNotificationsOpen}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Уведомления</SheetTitle>
              <SheetDescription>Последние действия в приложении.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-2 px-4">
              {session.notifications.length ? (
                session.notifications.map((message, index) => (
                  <div key={`${message}-${index}`} className="rounded-lg border p-3">
                    {message}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  Уведомлений пока нет.
                </p>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </SidebarProvider>
    </TooltipProvider>
  )
}
