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

type Workspace = {
  userName: string
  email: string
  householdName: string
  householdType: "personal" | "family"
  baseCurrency: string
}

const WORKSPACE_STORAGE_KEY = "bestbudget.workspace.v1"

const navItems = [
  { label: "Обзор", icon: HomeIcon, active: true },
  { label: "Операции", icon: ReceiptTextIcon },
  { label: "Бюджеты", icon: PiggyBankIcon },
  { label: "Календарь", icon: CalendarDaysIcon },
  { label: "Кредиты", icon: LandmarkIcon },
  { label: "Документы", icon: FileTextIcon },
  { label: "Семья", icon: UsersIcon },
  { label: "Настройки", icon: SettingsIcon },
]

const emptyCashflow = [
  { month: "Янв", income: 0, expense: 0 },
  { month: "Фев", income: 0, expense: 0 },
  { month: "Мар", income: 0, expense: 0 },
  { month: "Апр", income: 0, expense: 0 },
  { month: "Май", income: 0, expense: 0 },
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

function loadWorkspace() {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Workspace) : null
  } catch {
    return null
  }
}

function saveWorkspace(workspace: Workspace) {
  localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspace))
}

function clearWorkspace() {
  localStorage.removeItem(WORKSPACE_STORAGE_KEY)
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

function OnboardingScreen({
  onComplete,
}: {
  onComplete: (workspace: Workspace) => void
}) {
  const [form, setForm] = useState<Workspace>({
    userName: "",
    email: "",
    householdName: "",
    householdType: "family",
    baseCurrency: "RUB",
  })

  function updateField<Key extends keyof Workspace>(
    key: Key,
    value: Workspace[Key]
  ) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const workspace = {
      ...form,
      userName: form.userName.trim(),
      email: form.email.trim(),
      householdName: form.householdName.trim(),
      baseCurrency: form.baseCurrency.trim().toUpperCase(),
    }

    if (!workspace.userName || !workspace.householdName) {
      return
    }

    saveWorkspace(workspace)
    onComplete(workspace)
  }

  return (
    <main className="grid min-h-svh place-items-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Настройка пространства</CardTitle>
          <CardDescription>
            Укажите профиль владельца и название личного или семейного бюджета.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="userName">Ваше имя</FieldLabel>
                <Input
                  id="userName"
                  autoComplete="name"
                  value={form.userName}
                  onChange={(event) => updateField("userName", event.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) => updateField("email", event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="householdName">
                  Название пространства
                </FieldLabel>
                <Input
                  id="householdName"
                  value={form.householdName}
                  onChange={(event) =>
                    updateField("householdName", event.target.value)
                  }
                  placeholder="Например: Семья Ивановых"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="baseCurrency">Базовая валюта</FieldLabel>
                <Input
                  id="baseCurrency"
                  value={form.baseCurrency}
                  maxLength={3}
                  onChange={(event) =>
                    updateField("baseCurrency", event.target.value)
                  }
                  required
                />
                <FieldDescription>ISO-код: RUB, USD, EUR.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Тип пространства</FieldLabel>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={
                      form.householdType === "family" ? "default" : "outline"
                    }
                    onClick={() => updateField("householdType", "family")}
                  >
                    Семейное
                  </Button>
                  <Button
                    type="button"
                    variant={
                      form.householdType === "personal" ? "default" : "outline"
                    }
                    onClick={() => updateField("householdType", "personal")}
                  >
                    Личное
                  </Button>
                </div>
              </Field>
              <Button type="submit" size="lg">
                Войти в пространство
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

function AppSidebar({
  workspace,
  onReset,
}: {
  workspace: Workspace
  onReset: () => void
}) {
  const workspaceType =
    workspace.householdType === "family" ? "Семейное пространство" : "Личное"

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <BanknoteIcon />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">BestBudget</span>
                <span className="truncate text-xs text-muted-foreground">
                  {workspaceType}
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
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton isActive={item.active} tooltip={item.label}>
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
            <SidebarMenuButton>
              <Avatar className="size-8">
                <AvatarFallback>{getInitials(workspace.userName)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{workspace.userName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  owner
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onReset}>
              <LogOutIcon />
              <span>Сбросить вход</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

function KpiGrid({ currency }: { currency: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader>
          <CardDescription>Свободный остаток</CardDescription>
          <CardTitle>0 {currency}</CardTitle>
          <CardAction>
            <Badge variant="outline">0%</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Добавьте счета и операции, чтобы появился прогноз.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardDescription>Расходы месяца</CardDescription>
          <CardTitle>0 {currency}</CardTitle>
          <CardAction>
            <CreditCardIcon className="text-muted-foreground" />
          </CardAction>
        </CardHeader>
        <CardContent>
          <Progress value={0} />
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

function DashboardContent({ workspace }: { workspace: Workspace }) {
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const selectedKey = formatDateKey(selectedDate)
  const selectedLabel = selectedDate.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  const calendarItems: Array<{
    date: string
    title: string
    type: string
    amount: string | null
    status: string
  }> = []
  const transactions: Array<{
    title: string
    account: string
    category: string
    amount: string
    date: string
  }> = []
  const budgetRows: Array<{ name: string; used: number; value: string }> = []
  const dayItems = calendarItems.filter((item) => item.date === selectedKey)

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
          <Badge variant="outline">
            {workspace.householdName} · {workspace.baseCurrency}
          </Badge>
        </div>
        <Button variant="outline" size="icon" aria-label="Уведомления">
          <BellIcon />
        </Button>
        <Button>
          <PlusIcon data-icon="inline-start" />
          Операция
        </Button>
      </header>

      <ScrollArea className="h-[calc(100svh-3.5rem)]">
        <main className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-normal">
              {workspace.householdName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Пространство создано. Финансовые данные появятся после добавления
              счетов, операций, бюджетов и обязательств.
            </p>
          </div>

          <KpiGrid currency={workspace.baseCurrency} />

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
                          Пока нет операций для построения отчета.
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ChartContainer
                          config={chartConfig}
                          className="h-[300px] w-full"
                        >
                          <BarChart data={emptyCashflow}>
                            <CartesianGrid vertical={false} />
                            <XAxis
                              dataKey="month"
                              tickLine={false}
                              axisLine={false}
                            />
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
                    <Card>
                      <CardHeader>
                        <CardTitle>Исполнение бюджетов</CardTitle>
                        <CardDescription>
                          Бюджеты еще не настроены.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4">
                        {budgetRows.length > 0 ? (
                          budgetRows.map((row) => (
                            <div key={row.name} className="flex flex-col gap-2">
                              <div className="flex items-center justify-between gap-4 text-sm">
                                <span className="font-medium">{row.name}</span>
                                <span className="text-muted-foreground">
                                  {row.value}
                                </span>
                              </div>
                              <Progress value={row.used} />
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Создайте первый лимит по категории.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </TabsContent>
                  <TabsContent value="transactions">
                    <Card>
                      <CardHeader>
                        <CardTitle>Последние операции</CardTitle>
                        <CardDescription>
                          Операции еще не добавлены.
                        </CardDescription>
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
                            {transactions.length > 0 ? (
                              transactions.map((transaction) => (
                                <TableRow
                                  key={`${transaction.title}-${transaction.date}`}
                                >
                                  <TableCell className="font-medium">
                                    {transaction.title}
                                  </TableCell>
                                  <TableCell>{transaction.account}</TableCell>
                                  <TableCell>{transaction.category}</TableCell>
                                  <TableCell>{transaction.date}</TableCell>
                                  <TableCell className="text-right">
                                    {transaction.amount}
                                  </TableCell>
                                </TableRow>
                              ))
                            ) : (
                              <TableRow>
                                <TableCell
                                  colSpan={5}
                                  className="h-24 text-center text-muted-foreground"
                                >
                                  Нет операций
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={32} minSize={26}>
              <aside className="flex h-full flex-col gap-4 p-4">
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
                        booked: calendarItems.map(
                          (item) => new Date(`${item.date}T12:00:00`)
                        ),
                      }}
                      modifiersClassNames={{
                        booked:
                          "after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-primary",
                      }}
                    />
                  </CardContent>
                </Card>

                <Card className="flex-1">
                  <CardHeader>
                    <CardTitle>Правая панель даты</CardTitle>
                    <CardDescription>
                      Операции, платежи и напоминания.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {dayItems.length > 0 ? (
                      dayItems.map((item) => (
                        <div
                          key={item.title}
                          className="flex items-start justify-between gap-3 rounded-lg border p-3"
                        >
                          <div className="flex flex-col gap-1">
                            <div className="font-medium">{item.title}</div>
                            <div className="text-sm text-muted-foreground">
                              {item.type} · {item.status}
                            </div>
                          </div>
                          {item.amount ? (
                            <Badge variant="outline">{item.amount}</Badge>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        На выбранную дату нет операций или напоминаний.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </aside>
            </ResizablePanel>
          </ResizablePanelGroup>
        </main>
      </ScrollArea>
    </SidebarInset>
  )
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(() =>
    loadWorkspace()
  )

  function handleReset() {
    clearWorkspace()
    setWorkspace(null)
  }

  if (!workspace) {
    return (
      <TooltipProvider>
        <OnboardingScreen onComplete={setWorkspace} />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar workspace={workspace} onReset={handleReset} />
        <DashboardContent workspace={workspace} />
      </SidebarProvider>
    </TooltipProvider>
  )
}
