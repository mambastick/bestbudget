import { useMemo, useState } from "react"
import { toast, Toaster } from "sonner"

import { AppShell } from "@/components/app/app-shell"
import { AuthScreen, type LoginInput, type RegisterInput } from "@/components/app/auth-screen"
import {
  BudgetDialog,
  DocumentDialog,
  InviteDialog,
  LiabilityDialog,
  TransactionDialog,
  WorkspaceDialog,
  type BudgetInput,
  type DialogName,
  type DocumentInput,
  type LiabilityInput,
  type TransactionInput,
  type WorkspaceInput,
} from "@/components/app/dialogs"
import {
  BudgetsScreen,
  CalendarScreen,
  DocumentsScreen,
  FamilyScreen,
  LiabilitiesScreen,
  OverviewScreen,
  PageHeader,
  SettingsScreen,
  TransactionsScreen,
} from "@/components/app/screens"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  getActiveWorkspace,
  getCurrentUser,
  getUserWorkspaces,
  getWorkspaceBudgets,
  getWorkspaceCategories,
  getWorkspaceLiabilities,
  getWorkspaceTransactions,
} from "@/domain/selectors"
import {
  createId,
  createDemoAccount,
  createWorkspaceForUser,
  loadDatabase,
  loginAccount,
  normalizeDatabase,
  registerAccount,
  saveDatabase,
} from "@/domain/storage"
import type { AppDatabase, Category, View } from "@/domain/types"
import {
  coerceNonNegativeNumber,
  coercePositiveNumber,
  isEmailLike,
  isValidDateKey,
  normalizeDateKey,
  trimText,
} from "@/domain/validation"

const viewMeta: Record<View, { title: string; description: string }> = {
  overview: {
    title: "Обзор",
    description: "Главные цифры, последние операции и ближайшие платежи.",
  },
  transactions: {
    title: "Операции",
    description: "Доходы и расходы выбранного бюджета.",
  },
  budgets: {
    title: "Бюджеты",
    description: "Лимиты по категориям и прогресс расходов.",
  },
  calendar: {
    title: "Календарь",
    description: "Платежи, расходы и доходы по дням.",
  },
  liabilities: {
    title: "Кредиты",
    description: "Кредиты, ипотеки и регулярные платежи.",
  },
  documents: {
    title: "Документы",
    description: "PDF, чеки и файлы по выбранному бюджету.",
  },
  family: {
    title: "Семья",
    description: "Доступ семьи или команды к общему бюджету.",
  },
  settings: {
    title: "Настройки",
    description: "Аккаунт и бюджеты, с которыми вы работаете.",
  },
}

export default function App() {
  const [db, setDb] = useState<AppDatabase>(() => loadDatabase())
  const [activeView, setActiveView] = useState<View>("overview")
  const [searchQuery, setSearchQuery] = useState("")
  const [openDialog, setOpenDialog] = useState<DialogName>(null)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState(new Date())

  const user = getCurrentUser(db)
  const workspaces = user ? getUserWorkspaces(db, user.id) : []
  const activeWorkspace = getActiveWorkspace(db, db.session)
  const categories = getWorkspaceCategories(db, activeWorkspace?.id)
  const transactions = getWorkspaceTransactions(db, activeWorkspace?.id)
  const budgets = getWorkspaceBudgets(db, activeWorkspace?.id)
  const liabilities = getWorkspaceLiabilities(db, activeWorkspace?.id)
  const documents = db.documents.filter(
    (document) => document.workspaceId === activeWorkspace?.id
  )
  const meta = viewMeta[activeView]

  const recentEvents = useMemo(
    () => [
      ...transactions.slice(0, 3).map((transaction) => transaction.title),
      ...budgets.slice(0, 2).map((budget) => {
        const category = categories.find((item) => item.id === budget.categoryId)
        return `Бюджет: ${category?.name ?? "Категория"}`
      }),
      ...liabilities.slice(0, 2).map((liability) => liability.title),
    ],
    [budgets, categories, liabilities, transactions]
  )

  function persist(nextDb: AppDatabase, message?: string) {
    const normalizedDb = normalizeDatabase(nextDb)
    const saved = saveDatabase(normalizedDb)

    setDb(normalizedDb)

    if (!saved) {
      toast.error(
        "Данные изменены только в текущей сессии. Проверьте доступ к хранилищу браузера."
      )
      return false
    }

    if (message) {
      toast.success(message)
    }

    return true
  }

  async function handleRegister(input: RegisterInput) {
    const result = await registerAccount(db, input)

    if (!result.ok) {
      toast.error(result.error)
      return
    }

    persist(result.db, "Аккаунт создан")
    setActiveView("settings")
  }

  async function handleLogin(input: LoginInput) {
    const result = await loginAccount(db, input)

    if (!result.ok) {
      toast.error(result.error)
      return
    }

    persist(result.db, "Вход выполнен")
    setActiveView(result.session.activeWorkspaceId ? "overview" : "settings")
  }

  async function handleDemo() {
    const nextDb = await createDemoAccount(db)
    persist(nextDb, "Демо-бюджет открыт")
    setActiveView("overview")
    setSearchQuery("")
  }

  function handleLogout() {
    persist({ ...db, session: null })
    setActiveView("overview")
    setSearchQuery("")
    toast.info("Вы вышли из аккаунта")
  }

  function handleWorkspaceChange(workspaceId: string) {
    if (!db.session || !workspaces.some((workspace) => workspace.id === workspaceId)) {
      return
    }

    persist({
      ...db,
      session: {
        ...db.session,
        activeWorkspaceId: workspaceId,
      },
    })
    setActiveView("overview")
  }

  function openWorkspaceRequiredDialog(dialog: Exclude<DialogName, null>) {
    if (!activeWorkspace && dialog !== "workspace") {
      toast.warning("Сначала создайте бюджет")
      setOpenDialog("workspace")
      return
    }

    setOpenDialog(dialog)
  }

  function handleCreateWorkspace(input: WorkspaceInput) {
    if (!user) {
      return
    }

    if (!trimText(input.name)) {
      toast.error("Укажите название бюджета.")
      return
    }

    const nextDb = createWorkspaceForUser(db, user, input)
    persist(nextDb, "Бюджет создан")
    setOpenDialog(null)
    setActiveView("overview")
  }

  function createCustomCategory(
    currentDb: AppDatabase,
    workspaceId: string,
    input: { name: string; kind: Category["kind"] }
  ) {
    const name = trimText(input.name)
    const existingCategory = currentDb.categories.find(
      (category) =>
        category.workspaceId === workspaceId &&
        category.kind === input.kind &&
        category.name.trim().toLowerCase() === name.toLowerCase()
    )

    if (existingCategory) {
      return {
        db: currentDb,
        category: existingCategory,
      }
    }

    const category: Category = {
      id: createId("category"),
      workspaceId,
      name,
      kind: input.kind,
      icon: input.kind === "income" ? "💼" : "✦",
      color: "blue",
      custom: true,
    }

    return {
      db: {
        ...currentDb,
        categories: [...currentDb.categories, category],
      },
      category,
    }
  }

  function handleCreateTransaction(input: TransactionInput) {
    if (!activeWorkspace) {
      return
    }

    const title = trimText(input.title)
    const amount = coercePositiveNumber(input.amount)
    const date = isValidDateKey(input.date) ? input.date : null

    if (!title || amount === null || !date) {
      toast.error("Проверьте название, сумму и дату операции.")
      return
    }

    let nextDb = db
    let categoryId = input.categoryId

    if (input.newCategory) {
      if (!trimText(input.newCategory.name)) {
        toast.error("Укажите название новой категории.")
        return
      }

      const result = createCustomCategory(nextDb, activeWorkspace.id, input.newCategory)
      nextDb = result.db
      categoryId = result.category.id
    }

    const category = nextDb.categories.find(
      (item) => item.workspaceId === activeWorkspace.id && item.id === categoryId
    )

    if (!category || !isTransactionCategoryCompatible(category, input.type)) {
      toast.error("Выберите подходящую категорию для операции.")
      return
    }

    persist(
      {
        ...nextDb,
        transactions: [
          {
            id: createId("transaction"),
            workspaceId: activeWorkspace.id,
            title,
            account: trimText(input.account) || "Основной счет",
            categoryId,
            type: input.type,
            amount,
            date,
            note: trimText(input.note) || undefined,
          },
          ...nextDb.transactions,
        ],
      },
      "Операция сохранена"
    )
    setOpenDialog(null)
    setActiveView("transactions")
  }

  function handleCreateBudget(input: BudgetInput) {
    if (!activeWorkspace) {
      return
    }

    const limit = coercePositiveNumber(input.limit)

    if (limit === null) {
      toast.error("Укажите положительный лимит бюджета.")
      return
    }

    let nextDb = db
    let categoryId = input.categoryId

    if (input.newCategory) {
      if (!trimText(input.newCategory.name)) {
        toast.error("Укажите название новой категории.")
        return
      }

      const result = createCustomCategory(nextDb, activeWorkspace.id, input.newCategory)
      nextDb = result.db
      categoryId = result.category.id
    }

    const category = nextDb.categories.find(
      (item) => item.workspaceId === activeWorkspace.id && item.id === categoryId
    )

    if (!category || category.kind === "income") {
      toast.error("Для бюджета выберите расходную категорию.")
      return
    }

    const existingBudget = nextDb.budgets.find(
      (budget) =>
        budget.workspaceId === activeWorkspace.id &&
        budget.categoryId === categoryId &&
        budget.period === input.period
    )
    const budget = {
      id: existingBudget?.id ?? createId("budget"),
      workspaceId: activeWorkspace.id,
      categoryId,
      limit,
      period: input.period,
    }

    persist(
      {
        ...nextDb,
        budgets: existingBudget
          ? nextDb.budgets.map((item) => (item.id === existingBudget.id ? budget : item))
          : [budget, ...nextDb.budgets],
      },
      existingBudget ? "Бюджет обновлен" : "Бюджет добавлен"
    )
    setOpenDialog(null)
    setActiveView("budgets")
  }

  function handleInvite(input: { email: string }) {
    if (!activeWorkspace) {
      return
    }

    const email = input.email.trim().toLowerCase()

    if (!isEmailLike(email)) {
      toast.error("Укажите корректный email участника.")
      return
    }

    const alreadyMember = activeWorkspace.members.some(
      (member) => member.email.toLowerCase() === email
    )

    if (email === user?.email.toLowerCase()) {
      toast.warning("Вы уже владелец этого бюджета")
      return
    }

    if (alreadyMember) {
      toast.warning("Этот участник уже добавлен")
      return
    }

    persist(
      {
        ...db,
        workspaces: db.workspaces.map((workspace) =>
          workspace.id === activeWorkspace.id
            ? {
                ...workspace,
                members: [
                  ...workspace.members,
                  {
                    id: createId("member"),
                    userId: null,
                    name: email.split("@")[0] || "Участник",
                    email,
                    role: "member",
                    status: "invited",
                  },
                ],
              }
            : workspace
        ),
      },
      "Приглашение добавлено"
    )
    setOpenDialog(null)
    setActiveView("family")
  }

  function handleCreateLiability(input: LiabilityInput) {
    if (!activeWorkspace) {
      return
    }

    const title = trimText(input.title)
    const balance = coercePositiveNumber(input.balance)
    const monthlyPayment = coercePositiveNumber(input.monthlyPayment)
    const rate = coerceNonNegativeNumber(input.rate) ?? 0
    const nextPayment = isValidDateKey(input.nextPayment) ? input.nextPayment : null

    if (!title || balance === null || monthlyPayment === null || !nextPayment) {
      toast.error("Проверьте название, суммы и дату платежа.")
      return
    }

    persist(
      {
        ...db,
        liabilities: [
          {
            id: createId("liability"),
            workspaceId: activeWorkspace.id,
            title,
            balance,
            monthlyPayment,
            rate,
            nextPayment,
          },
          ...db.liabilities,
        ],
      },
      "Обязательство добавлено"
    )
    setOpenDialog(null)
    setActiveView("liabilities")
  }

  function handleCreateDocument(input: DocumentInput) {
    if (!activeWorkspace) {
      return
    }

    const fileName = trimText(input.fileName)

    if (!fileName) {
      toast.error("Выберите файл документа.")
      return
    }

    persist(
      {
        ...db,
        documents: [
          {
            id: createId("document"),
            workspaceId: activeWorkspace.id,
            title: trimText(input.title) || fileName,
            fileName,
            fileData: trimText(input.fileData) || undefined,
            fileSize: coerceNonNegativeNumber(input.fileSize) ?? undefined,
            mimeType: trimText(input.mimeType) || undefined,
            linkedTo: trimText(input.linkedTo) || "Не привязан",
            status: input.status,
            uploadedAt: normalizeDateKey(input.uploadedAt),
          },
          ...db.documents,
        ],
      },
      "Документ добавлен"
    )
    setOpenDialog(null)
    setActiveView("documents")
  }

  if (!user || !db.session) {
    return (
      <>
        <AuthScreen
          onRegister={handleRegister}
          onLogin={handleLogin}
          onDemo={handleDemo}
        />
        <Toaster position="bottom-right" richColors />
      </>
    )
  }

  return (
    <>
      <AppShell
        user={user}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        activeView={activeView}
        searchQuery={searchQuery}
        onNavigate={setActiveView}
        onSearchChange={setSearchQuery}
        onWorkspaceChange={handleWorkspaceChange}
        onCreateWorkspace={() => setOpenDialog("workspace")}
        onOpenDialog={openWorkspaceRequiredDialog}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onLogout={handleLogout}
      >
        <main className="app-main flex min-w-0 flex-col gap-5 p-4 lg:p-5">
          <PageHeader title={meta.title} description={meta.description} />
          {activeView === "overview" ? (
            <OverviewScreen
              workspace={activeWorkspace}
              categories={categories}
              transactions={transactions}
              budgets={budgets}
              liabilities={liabilities}
              documents={documents}
              onOpenDialog={openWorkspaceRequiredDialog}
            />
          ) : null}
          {activeView === "transactions" ? (
            <TransactionsScreen
              workspace={activeWorkspace}
              categories={categories}
              transactions={transactions}
              searchQuery={searchQuery}
              onOpenDialog={openWorkspaceRequiredDialog}
            />
          ) : null}
          {activeView === "budgets" ? (
            <BudgetsScreen
              workspace={activeWorkspace}
              categories={categories}
              transactions={transactions}
              budgets={budgets}
              searchQuery={searchQuery}
              onOpenDialog={openWorkspaceRequiredDialog}
            />
          ) : null}
          {activeView === "calendar" ? (
            <CalendarScreen
              workspace={activeWorkspace}
              categories={categories}
              transactions={transactions}
              liabilities={liabilities}
              searchQuery={searchQuery}
              selectedDate={selectedDate}
              onDateChange={setSelectedDate}
              onOpenDialog={openWorkspaceRequiredDialog}
            />
          ) : null}
          {activeView === "liabilities" ? (
            <LiabilitiesScreen
              workspace={activeWorkspace}
              liabilities={liabilities}
              searchQuery={searchQuery}
              onOpenDialog={openWorkspaceRequiredDialog}
            />
          ) : null}
          {activeView === "documents" ? (
            <DocumentsScreen
              workspace={activeWorkspace}
              documents={documents}
              searchQuery={searchQuery}
              onOpenDialog={openWorkspaceRequiredDialog}
            />
          ) : null}
          {activeView === "family" ? (
            <FamilyScreen
              user={user}
              workspace={activeWorkspace}
              searchQuery={searchQuery}
              onOpenDialog={openWorkspaceRequiredDialog}
            />
          ) : null}
          {activeView === "settings" ? (
            <SettingsScreen
              user={user}
              workspace={activeWorkspace}
              onOpenDialog={openWorkspaceRequiredDialog}
            />
          ) : null}
        </main>
      </AppShell>

      <WorkspaceDialog
        open={openDialog === "workspace"}
        onOpenChange={(open) => setOpenDialog(open ? "workspace" : null)}
        onSubmit={handleCreateWorkspace}
      />
      <TransactionDialog
        open={openDialog === "transaction"}
        categories={categories}
        currencyCode={activeWorkspace?.currencyCode ?? "RUB"}
        onOpenChange={(open) => setOpenDialog(open ? "transaction" : null)}
        onSubmit={handleCreateTransaction}
      />
      <BudgetDialog
        open={openDialog === "budget"}
        categories={categories}
        onOpenChange={(open) => setOpenDialog(open ? "budget" : null)}
        onSubmit={handleCreateBudget}
      />
      <InviteDialog
        open={openDialog === "invite"}
        onOpenChange={(open) => setOpenDialog(open ? "invite" : null)}
        onSubmit={handleInvite}
      />
      <LiabilityDialog
        open={openDialog === "liability"}
        onOpenChange={(open) => setOpenDialog(open ? "liability" : null)}
        onSubmit={handleCreateLiability}
      />
      <DocumentDialog
        open={openDialog === "document"}
        onOpenChange={(open) => setOpenDialog(open ? "document" : null)}
        onSubmit={handleCreateDocument}
      />
      <NotificationsSheet
        open={notificationsOpen}
        items={recentEvents}
        onOpenChange={setNotificationsOpen}
      />
      <Toaster position="bottom-right" richColors />
    </>
  )
}

function isTransactionCategoryCompatible(
  category: Category,
  type: TransactionInput["type"]
) {
  return category.kind === type || category.kind === "neutral"
}

function NotificationsSheet({
  open,
  items,
  onOpenChange,
}: {
  open: boolean
  items: string[]
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Уведомления</SheetTitle>
          <SheetDescription>Последние действия по бюджету.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 px-4 pb-4">
          {items.length ? (
            items.map((item, index) => (
              <div key={`${item}-${index}`} className="rounded-lg border p-3">
                {item}
              </div>
            ))
          ) : (
            <p className="rounded-lg border p-3 text-sm text-muted-foreground">
              Пока нет событий.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
