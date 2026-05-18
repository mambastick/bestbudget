import type {
  AppDatabase,
  AppSession,
  Budget,
  Category,
  Liability,
  Transaction,
  User,
  Workspace,
} from "./types"

export function getCurrentUser(db: AppDatabase): User | null {
  if (!db.session) {
    return null
  }

  return db.users.find((user) => user.id === db.session?.userId) ?? null
}

export function getUserWorkspaces(db: AppDatabase, userId: string) {
  return db.workspaces.filter((workspace) =>
    workspace.members.some(
      (member) => member.userId === userId && member.status === "active"
    )
  )
}

export function getActiveWorkspace(
  db: AppDatabase,
  session: AppSession | null
): Workspace | null {
  if (!session?.activeWorkspaceId) {
    return null
  }

  return (
    db.workspaces.find((workspace) => workspace.id === session.activeWorkspaceId) ??
    null
  )
}

export function getWorkspaceCategories(db: AppDatabase, workspaceId?: string | null) {
  if (!workspaceId) {
    return []
  }

  return db.categories.filter((category) => category.workspaceId === workspaceId)
}

export function getWorkspaceTransactions(
  db: AppDatabase,
  workspaceId?: string | null
) {
  if (!workspaceId) {
    return []
  }

  return db.transactions.filter(
    (transaction) => transaction.workspaceId === workspaceId
  )
}

export function getWorkspaceBudgets(db: AppDatabase, workspaceId?: string | null) {
  if (!workspaceId) {
    return []
  }

  return db.budgets.filter((budget) => budget.workspaceId === workspaceId)
}

export function getWorkspaceLiabilities(
  db: AppDatabase,
  workspaceId?: string | null
) {
  if (!workspaceId) {
    return []
  }

  return db.liabilities.filter(
    (liability) => liability.workspaceId === workspaceId
  )
}

export function getCategory(categories: Category[], categoryId: string) {
  return categories.find((category) => category.id === categoryId) ?? null
}

export function summarizeWorkspace(params: {
  transactions: Transaction[]
  budgets: Budget[]
  liabilities: Liability[]
}) {
  const income = params.transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((total, transaction) => total + transaction.amount, 0)
  const expense = params.transactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((total, transaction) => total + transaction.amount, 0)
  const monthlyDebt = params.liabilities.reduce(
    (total, liability) => total + liability.monthlyPayment,
    0
  )

  return {
    income,
    expense,
    balance: income - expense,
    monthlyDebt,
    budgetCount: params.budgets.length,
  }
}

export function matchesSearch(values: Array<string | number>, query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return true
  }

  return values.join(" ").toLowerCase().includes(normalizedQuery)
}
