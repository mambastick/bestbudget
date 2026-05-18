import { categoryPresets } from "./presets"
import type {
  AppDatabase,
  AppSession,
  Category,
  User,
  Workspace,
} from "./types"

const STORAGE_KEY = "bestbudget.app.v1"
const LEGACY_KEYS = ["bestbudget.session.v2", "bestbudget.session.v3"]

export type AuthResult =
  | { ok: true; db: AppDatabase; session: AppSession }
  | { ok: false; error: string }

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key))
}

export function normalizeDatabase(value: unknown): AppDatabase {
  const db = value as Partial<AppDatabase>
  const fallback = createEmptyDatabase()

  return {
    version: 1,
    users: Array.isArray(db.users) ? db.users : fallback.users,
    workspaces: Array.isArray(db.workspaces)
      ? db.workspaces
      : fallback.workspaces,
    categories: Array.isArray(db.categories)
      ? db.categories
      : fallback.categories,
    transactions: Array.isArray(db.transactions)
      ? db.transactions
      : fallback.transactions,
    budgets: Array.isArray(db.budgets) ? db.budgets : fallback.budgets,
    liabilities: Array.isArray(db.liabilities)
      ? db.liabilities
      : fallback.liabilities,
    documents: Array.isArray(db.documents) ? db.documents : fallback.documents,
    session: db.session?.userId ? db.session : null,
  }
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

  if (!name || !email || input.password.length < 6) {
    return {
      ok: false,
      error: "Укажите имя, email и пароль не короче 6 символов.",
    }
  }

  if (db.users.some((user) => user.email.toLowerCase() === email)) {
    return { ok: false, error: "Аккаунт с таким email уже существует." }
  }

  const user: User = {
    id: createId("user"),
    name,
    email,
    passwordHash: await hashPassword(input.password),
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
  const workspace: Workspace = {
    id: workspaceId,
    name: input.name.trim(),
    accessMode: input.accessMode,
    currencyCode: input.currencyCode,
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
