export type View =
  | "overview"
  | "transactions"
  | "budgets"
  | "calendar"
  | "liabilities"
  | "documents"
  | "family"
  | "settings"

export type AccessMode = "individual" | "shared"

export type User = {
  id: string
  name: string
  email: string
  passwordHash: string
  createdAt: string
}

export type WorkspaceMember = {
  id: string
  userId: string | null
  name: string
  email: string
  role: "owner" | "admin" | "member" | "observer"
  status: "active" | "invited"
}

export type Workspace = {
  id: string
  name: string
  accessMode: AccessMode
  currencyCode: string
  ownerId: string
  members: WorkspaceMember[]
  createdAt: string
}

export type Category = {
  id: string
  workspaceId: string
  name: string
  kind: "income" | "expense" | "neutral"
  icon: string
  color: string
  custom: boolean
}

export type Transaction = {
  id: string
  workspaceId: string
  title: string
  account: string
  categoryId: string
  type: "income" | "expense"
  amount: number
  date: string
  note?: string
}

export type Budget = {
  id: string
  workspaceId: string
  categoryId: string
  limit: number
  period: "month" | "quarter" | "year"
}

export type Liability = {
  id: string
  workspaceId: string
  title: string
  balance: number
  monthlyPayment: number
  rate: number
  nextPayment: string
}

export type DocumentRecord = {
  id: string
  workspaceId: string
  title: string
  fileName: string
  fileData?: string
  fileSize?: number
  mimeType?: string
  linkedTo: string
  status: "uploaded" | "checked"
  uploadedAt: string
}

export type AppSession = {
  userId: string
  activeWorkspaceId: string | null
}

export type AppDatabase = {
  version: 1
  users: User[]
  workspaces: Workspace[]
  categories: Category[]
  transactions: Transaction[]
  budgets: Budget[]
  liabilities: Liability[]
  documents: DocumentRecord[]
  session: AppSession | null
}
