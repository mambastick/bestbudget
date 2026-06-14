import { categoryPresets, getCurrency } from "./presets"
import type {
  AppDatabase,
  AppSession,
  Budget,
  Category,
  DocumentRecord,
  Liability,
  Transaction,
  User,
  Workspace,
  WorkspaceMember,
} from "./types"
import {
  coerceNonNegativeNumber,
  coercePositiveNumber,
  isEmailLike,
  normalizeDateKey,
  trimText,
} from "./validation"

const STORAGE_KEY = "bestbudget.app.v1"
const LEGACY_KEYS = ["bestbudget.session.v2", "bestbudget.session.v3"]

export type AuthResult =
  | { ok: true; db: AppDatabase; session: AppSession }
  | { ok: false; error: string }

export function createId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`
  }

  const fallbackId = `${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`

  return `${prefix}_${fallbackId}`
}

export function createEmptyDatabase(): AppDatabase {
  return {
    version: 1,
    users: [],
    workspaces: [],
    categories: [],
    transactions: [],
    budgets: [],
    liabilities: [],
    documents: [],
    session: null,
  }
}

function formatDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")

  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)

  return next
}

export function loadDatabase(): AppDatabase {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return createEmptyDatabase()
    }

    return normalizeDatabase(JSON.parse(raw))
  } catch {
    return createEmptyDatabase()
  }
}

export function saveDatabase(db: AppDatabase) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeDatabase(db)))
    LEGACY_KEYS.forEach((key) => localStorage.removeItem(key))
    return true
  } catch {
    return false
  }
}

export function normalizeDatabase(value: unknown): AppDatabase {
  const db = (asRecord(value) ?? {}) as Partial<AppDatabase>
  const users = normalizeUsers(db.users)
  const workspaces = normalizeWorkspaces(db.workspaces)
  const categories = normalizeCategories(db.categories)
  const transactions = normalizeTransactions(db.transactions)
  const budgets = normalizeBudgets(db.budgets)
  const liabilities = normalizeLiabilities(db.liabilities)
  const documents = normalizeDocuments(db.documents)

  return {
    version: 1,
    users,
    workspaces,
    categories,
    transactions,
    budgets,
    liabilities,
    documents,
    session: normalizeSession(db.session, users, workspaces),
  }
}

function normalizeUsers(value: unknown): User[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    const record = asRecord(item)
    const id = trimText(record?.id)
    const name = trimText(record?.name)
    const email = trimText(record?.email).toLowerCase()
    const passwordHash = trimText(record?.passwordHash)

    if (!record || !id || !name || !email || !passwordHash) {
      return []
    }

    return [
      {
        id,
        name,
        email,
        passwordHash,
        createdAt: trimText(record.createdAt) || new Date().toISOString(),
      },
    ]
  })
}

function normalizeWorkspaces(value: unknown): Workspace[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    const record = asRecord(item)
    const id = trimText(record?.id)
    const name = trimText(record?.name)
    const ownerId = trimText(record?.ownerId)

    if (!record || !id || !name || !ownerId) {
      return []
    }

    return [
      {
        id,
        name,
        accessMode: isAccessMode(record.accessMode)
          ? record.accessMode
          : "individual",
        currencyCode: getCurrency(trimText(record.currencyCode)).code,
        ownerId,
        members: normalizeMembers(record.members),
        createdAt: trimText(record.createdAt) || new Date().toISOString(),
      },
    ]
  })
}

function normalizeMembers(value: unknown): WorkspaceMember[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    const record = asRecord(item)
    const id = trimText(record?.id)
    const email = trimText(record?.email).toLowerCase()
    const userId = trimText(record?.userId) || null

    if (!record || !id || !email) {
      return []
    }

    return [
      {
        id,
        userId,
        name: trimText(record.name) || email.split("@")[0] || "Участник",
        email,
        role: isMemberRole(record.role) ? record.role : "member",
        status: isMemberStatus(record.status) ? record.status : "active",
      },
    ]
  })
}

function normalizeCategories(value: unknown): Category[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    const record = asRecord(item)
    const id = trimText(record?.id)
    const workspaceId = trimText(record?.workspaceId)
    const name = trimText(record?.name)

    if (!record || !id || !workspaceId || !name || !isCategoryKind(record.kind)) {
      return []
    }

    return [
      {
        id,
        workspaceId,
        name,
        kind: record.kind,
        icon: trimText(record.icon) || "✦",
        color: trimText(record.color) || "blue",
        custom: typeof record.custom === "boolean" ? record.custom : true,
      },
    ]
  })
}

function normalizeTransactions(value: unknown): Transaction[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    const record = asRecord(item)
    const id = trimText(record?.id)
    const workspaceId = trimText(record?.workspaceId)
    const title = trimText(record?.title)
    const amount = coercePositiveNumber(record?.amount)

    if (!record || !id || !workspaceId || !title || amount === null) {
      return []
    }

    return [
      {
        id,
        workspaceId,
        title,
        account: trimText(record.account) || "Основной счет",
        categoryId: trimText(record.categoryId),
        type: record.type === "income" ? "income" : "expense",
        amount,
        date: normalizeDateKey(record.date),
        note: trimText(record.note) || undefined,
      },
    ]
  })
}

function normalizeBudgets(value: unknown): Budget[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    const record = asRecord(item)
    const id = trimText(record?.id)
    const workspaceId = trimText(record?.workspaceId)
    const categoryId = trimText(record?.categoryId)
    const limit = coercePositiveNumber(record?.limit)

    if (!record || !id || !workspaceId || !categoryId || limit === null) {
      return []
    }

    return [
      {
        id,
        workspaceId,
        categoryId,
        limit,
        period: isBudgetPeriod(record.period) ? record.period : "month",
      },
    ]
  })
}

function normalizeLiabilities(value: unknown): Liability[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    const record = asRecord(item)
    const id = trimText(record?.id)
    const workspaceId = trimText(record?.workspaceId)
    const title = trimText(record?.title)
    const balance = coercePositiveNumber(record?.balance)
    const monthlyPayment = coercePositiveNumber(record?.monthlyPayment)

    if (
      !record ||
      !id ||
      !workspaceId ||
      !title ||
      balance === null ||
      monthlyPayment === null
    ) {
      return []
    }

    return [
      {
        id,
        workspaceId,
        title,
        balance,
        monthlyPayment,
        rate: coerceNonNegativeNumber(record.rate) ?? 0,
        nextPayment: normalizeDateKey(record.nextPayment),
      },
    ]
  })
}

function normalizeDocuments(value: unknown): DocumentRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    const record = asRecord(item)
    const id = trimText(record?.id)
    const workspaceId = trimText(record?.workspaceId)
    const fileName = trimText(record?.fileName)

    if (!record || !id || !workspaceId || !fileName) {
      return []
    }

    return [
      {
        id,
        workspaceId,
        title: trimText(record.title) || fileName,
        fileName,
        fileData: trimText(record.fileData) || undefined,
        fileSize: coerceNonNegativeNumber(record.fileSize) ?? undefined,
        mimeType: trimText(record.mimeType) || undefined,
        linkedTo: trimText(record.linkedTo) || "Не привязан",
        status: record.status === "checked" ? "checked" : "uploaded",
        uploadedAt: normalizeDateKey(record.uploadedAt),
      },
    ]
  })
}

function normalizeSession(
  value: unknown,
  users: User[],
  workspaces: Workspace[]
): AppSession | null {
  const record = asRecord(value)
  const userId = trimText(record?.userId)

  if (!record || !users.some((user) => user.id === userId)) {
    return null
  }

  const availableWorkspaces = workspaces.filter((workspace) =>
    workspace.members.some(
      (member) => member.userId === userId && member.status === "active"
    )
  )
  const requestedWorkspaceId = trimText(record.activeWorkspaceId)
  const activeWorkspaceId = availableWorkspaces.some(
    (workspace) => workspace.id === requestedWorkspaceId
  )
    ? requestedWorkspaceId
    : availableWorkspaces[0]?.id ?? null

  return {
    userId,
    activeWorkspaceId,
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null
}

function isAccessMode(value: unknown): value is Workspace["accessMode"] {
  return value === "individual" || value === "shared"
}

function isMemberRole(value: unknown): value is WorkspaceMember["role"] {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "member" ||
    value === "observer"
  )
}

function isMemberStatus(value: unknown): value is WorkspaceMember["status"] {
  return value === "active" || value === "invited"
}

function isCategoryKind(value: unknown): value is Category["kind"] {
  return value === "income" || value === "expense" || value === "neutral"
}

function isBudgetPeriod(value: unknown): value is Budget["period"] {
  return value === "month" || value === "quarter" || value === "year"
}

export async function hashPassword(password: string) {
  const normalized = password.trim()
  const encoder = new TextEncoder()
  const data = encoder.encode(`bestbudget:${normalized}`)
  const digest = await crypto.subtle.digest("SHA-256", data)
  const bytes = Array.from(new Uint8Array(digest))

  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export async function registerAccount(
  db: AppDatabase,
  input: { name: string; email: string; password: string }
): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()
  const password = input.password.trim()

  if (!name || !isEmailLike(email) || password.length < 6) {
    return {
      ok: false,
      error: "Укажите имя, корректный email и пароль не короче 6 символов.",
    }
  }

  if (db.users.some((user) => user.email.toLowerCase() === email)) {
    return { ok: false, error: "Аккаунт с таким email уже существует." }
  }

  const user: User = {
    id: createId("user"),
    name,
    email,
    passwordHash: await hashPassword(password),
    createdAt: new Date().toISOString(),
  }
  const session: AppSession = {
    userId: user.id,
    activeWorkspaceId: null,
  }

  return {
    ok: true,
    db: {
      ...db,
      users: [...db.users, user],
      session,
    },
    session,
  }
}

export async function createDemoAccount(db: AppDatabase): Promise<AppDatabase> {
  const email = "demo@bestbudget.local"
  const existingUser = db.users.find((user) => user.email === email)

  if (existingUser) {
    const workspace = db.workspaces.find((item) =>
      item.members.some(
        (member) => member.userId === existingUser.id && member.status === "active"
      )
    )

    return {
      ...db,
      session: {
        userId: existingUser.id,
        activeWorkspaceId: workspace?.id ?? null,
      },
    }
  }

  const today = new Date()
  const workspaceId = createId("workspace")
  const user: User = {
    id: createId("user"),
    name: "Демо пользователь",
    email,
    passwordHash: await hashPassword("demo123"),
    createdAt: today.toISOString(),
  }
  const workspace: Workspace = {
    id: workspaceId,
    name: "Семейный бюджет",
    accessMode: "shared",
    currencyCode: "RUB",
    ownerId: user.id,
    members: [
      {
        id: createId("member"),
        userId: user.id,
        name: user.name,
        email: user.email,
        role: "owner",
        status: "active",
      },
      {
        id: createId("member"),
        userId: null,
        name: "Анна",
        email: "anna@example.com",
        role: "member",
        status: "invited",
      },
    ],
    createdAt: today.toISOString(),
  }
  const categories: Category[] = categoryPresets.map((preset) => ({
    id: createId("category"),
    workspaceId,
    name: preset.name,
    kind: preset.kind,
    icon: preset.icon,
    color: preset.color,
    custom: false,
  }))
  const categoryByName = new Map(
    categories.map((category) => [category.name, category.id])
  )
  const transactions: Transaction[] = [
    {
      id: createId("transaction"),
      workspaceId,
      title: "Зарплата",
      account: "Основной счет",
      categoryId: categoryByName.get("Доход") ?? categories[0]?.id ?? "",
      type: "income",
      amount: 245000,
      date: formatDateKey(addDays(today, -8)),
    },
    {
      id: createId("transaction"),
      workspaceId,
      title: "Продукты на неделю",
      account: "Карта",
      categoryId: categoryByName.get("Еда") ?? categories[0]?.id ?? "",
      type: "expense",
      amount: 14800,
      date: formatDateKey(addDays(today, -2)),
    },
    {
      id: createId("transaction"),
      workspaceId,
      title: "Интернет и мобильная связь",
      account: "Карта",
      categoryId: categoryByName.get("Связь") ?? categories[0]?.id ?? "",
      type: "expense",
      amount: 3200,
      date: formatDateKey(today),
    },
    {
      id: createId("transaction"),
      workspaceId,
      title: "Такси",
      account: "Карта",
      categoryId: categoryByName.get("Транспорт") ?? categories[0]?.id ?? "",
      type: "expense",
      amount: 1850,
      date: formatDateKey(addDays(today, 1)),
    },
    {
      id: createId("transaction"),
      workspaceId,
      title: "Кино",
      account: "Карта",
      categoryId: categoryByName.get("Развлечения") ?? categories[0]?.id ?? "",
      type: "expense",
      amount: 2600,
      date: formatDateKey(addDays(today, -4)),
    },
  ]
  const budgets: Budget[] = [
    ["Еда", 60000],
    ["Транспорт", 18000],
    ["Развлечения", 12000],
    ["Связь", 7000],
  ].flatMap(([name, limit]) => {
    const categoryId = categoryByName.get(String(name))

    return categoryId
      ? [
          {
            id: createId("budget"),
            workspaceId,
            categoryId,
            limit: Number(limit),
            period: "month" as const,
          },
        ]
      : []
  })
  const liabilities: Liability[] = [
    {
      id: createId("liability"),
      workspaceId,
      title: "Ипотека",
      balance: 8420000,
      monthlyPayment: 72000,
      rate: 8.4,
      nextPayment: formatDateKey(addDays(today, 6)),
    },
  ]
  const documents: DocumentRecord[] = [
    {
      id: createId("document"),
      workspaceId,
      title: "Полис страхования",
      fileName: "insurance-policy.svg",
      fileData:
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' fill='%23f8fafc'/%3E%3Crect x='40' y='40' width='560' height='280' rx='18' fill='white' stroke='%23cbd5e1'/%3E%3Ctext x='80' y='120' font-family='Arial' font-size='34' font-weight='700' fill='%230f172a'%3EInsurance policy%3C/text%3E%3Ctext x='80' y='170' font-family='Arial' font-size='22' fill='%23475569'%3EDemo document saved locally%3C/text%3E%3Ctext x='80' y='230' font-family='Arial' font-size='18' fill='%2364748b'%3EBestBudget%3C/text%3E%3C/svg%3E",
      fileSize: 742,
      mimeType: "image/svg+xml",
      linkedTo: "Ипотека",
      status: "checked",
      uploadedAt: formatDateKey(addDays(today, -14)),
    },
  ]

  return {
    ...db,
    users: [...db.users, user],
    workspaces: [...db.workspaces, workspace],
    categories: [...db.categories, ...categories],
    transactions: [...transactions, ...db.transactions],
    budgets: [...budgets, ...db.budgets],
    liabilities: [...liabilities, ...db.liabilities],
    documents: [...documents, ...db.documents],
    session: {
      userId: user.id,
      activeWorkspaceId: workspaceId,
    },
  }
}

export async function loginAccount(
  db: AppDatabase,
  input: { email: string; password: string }
): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase()
  const user = db.users.find((item) => item.email.toLowerCase() === email)

  if (!user) {
    return { ok: false, error: "Аккаунт не найден." }
  }

  if (user.passwordHash !== (await hashPassword(input.password))) {
    return { ok: false, error: "Неверный пароль." }
  }

  const activeWorkspace =
    db.workspaces.find((workspace) =>
      workspace.members.some(
        (member) => member.userId === user.id && member.status === "active"
      )
    ) ?? null
  const session: AppSession = {
    userId: user.id,
    activeWorkspaceId: activeWorkspace?.id ?? null,
  }

  return {
    ok: true,
    db: {
      ...db,
      session,
    },
    session,
  }
}

export function createWorkspaceForUser(
  db: AppDatabase,
  user: User,
  input: { name: string; accessMode: Workspace["accessMode"]; currencyCode: string }
) {
  const workspaceId = createId("workspace")
  const name = input.name.trim() || "Новый бюджет"
  const workspace: Workspace = {
    id: workspaceId,
    name,
    accessMode: input.accessMode,
    currencyCode: getCurrency(input.currencyCode).code,
    ownerId: user.id,
    members: [
      {
        id: createId("member"),
        userId: user.id,
        name: user.name,
        email: user.email,
        role: "owner",
        status: "active",
      },
    ],
    createdAt: new Date().toISOString(),
  }
  const categories: Category[] = categoryPresets.map((preset) => ({
    id: createId("category"),
    workspaceId,
    name: preset.name,
    kind: preset.kind,
    icon: preset.icon,
    color: preset.color,
    custom: false,
  }))

  return {
    ...db,
    workspaces: [...db.workspaces, workspace],
    categories: [...db.categories, ...categories],
    session: {
      userId: user.id,
      activeWorkspaceId: workspaceId,
    },
  } satisfies AppDatabase
}
