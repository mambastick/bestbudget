import { categoryPresets, getCurrency } from "./presets"
import { resolveSsoRoleMapping } from "./rbac"
import { workspacePermissions, workspaceRoles } from "./types"
import type {
  AppDatabase,
  AppSession,
  Budget,
  Category,
  DocumentRecord,
  Liability,
  OidcProviderConfig,
  SamlProviderConfig,
  SsoClaimValue,
  SsoProviderConfig,
  SsoRoleMapping,
  SsoSession,
  Transaction,
  User,
  Workspace,
  WorkspaceMember,
  WorkspacePermission,
  WorkspaceRole,
} from "./types"
import {
  coerceNonNegativeNumber,
  coercePositiveNumber,
  isEmailLike,
  normalizeEmail,
  normalizeDateKey,
  normalizeHttpUrl,
  normalizeIsoDateTime,
  normalizeOptionalIsoDateTime,
  normalizeScopeList,
  normalizeStringList,
  trimText,
} from "./validation"

const STORAGE_KEY = "bestbudget.app.v1"
const LEGACY_KEYS = ["bestbudget.session.v2", "bestbudget.session.v3"]

export type AuthResult =
  | { ok: true; db: AppDatabase; session: AppSession }
  | { ok: false; error: string }

export type SsoLoginProfile = {
  providerId: string
  subject: string
  email: string
  name: string
  groups: string[]
  roles: string[]
  claims: Record<string, unknown>
  expiresAt?: string
}

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
    ssoProviders: [],
    ssoRoleMappings: [],
    ssoSessions: [],
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
  const ssoProviders = normalizeSsoProviders(db.ssoProviders, workspaces)
  const ssoRoleMappings = normalizeSsoRoleMappings(
    db.ssoRoleMappings,
    ssoProviders,
    workspaces
  )
  const ssoSessions = normalizeSsoSessions(db.ssoSessions, users, ssoProviders)
  const categories = normalizeCategories(db.categories)
  const transactions = normalizeTransactions(db.transactions)
  const budgets = normalizeBudgets(db.budgets)
  const liabilities = normalizeLiabilities(db.liabilities)
  const documents = normalizeDocuments(db.documents)

  return {
    version: 1,
    users,
    workspaces,
    ssoProviders,
    ssoRoleMappings,
    ssoSessions,
    categories,
    transactions,
    budgets,
    liabilities,
    documents,
    session: normalizeSession(db.session, users, workspaces, ssoSessions),
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
    const authProvider = record?.authProvider === "sso" ? "sso" : "local"
    const passwordHash =
      trimText(record?.passwordHash) || (authProvider === "sso" ? "sso" : "")

    if (!record || !id || !name || !email || !passwordHash) {
      return []
    }

    return [
      {
        id,
        name,
        email,
        passwordHash,
        authProvider,
        ssoProviderId: trimText(record.ssoProviderId) || undefined,
        externalSubject: trimText(record.externalSubject) || undefined,
        lastLoginAt: normalizeOptionalIsoDateTime(record.lastLoginAt),
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
        permissions: normalizePermissions(record.permissions),
      },
    ]
  })
}

function normalizeSsoProviders(
  value: unknown,
  workspaces: Workspace[]
): SsoProviderConfig[] {
  if (!Array.isArray(value)) {
    return []
  }

  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id))

  return value.flatMap<SsoProviderConfig>((item) => {
    const record = asRecord(item)
    const id = trimText(record?.id)
    const name = trimText(record?.name)
    const workspaceId = trimText(record?.workspaceId)

    if (!record || !id || !name || !workspaceIds.has(workspaceId)) {
      return []
    }

    const providerKind: SsoProviderConfig["providerKind"] = isSsoProviderKind(
      record.providerKind
    )
      ? record.providerKind
      : record.type === "saml"
        ? "saml"
        : "oidc"
    const status: SsoProviderConfig["status"] =
      record.status === "disabled" ? "disabled" : "enabled"
    const common = {
      id,
      workspaceId,
      providerKind,
      name,
      status,
      domainHint: normalizeDomainHint(record.domainHint),
      createdAt: normalizeIsoDateTime(record.createdAt),
      updatedAt: normalizeOptionalIsoDateTime(record.updatedAt),
    }

    if (record.type === "oidc") {
      const issuer = normalizeHttpUrl(record.issuer)
      const clientId = trimText(record.clientId)

      if (!issuer || !clientId) {
        return []
      }

      return [
        {
          ...common,
          type: "oidc",
          issuer,
          clientId,
          authorizationEndpoint:
            normalizeHttpUrl(record.authorizationEndpoint) ?? undefined,
          redirectUri: normalizeHttpUrl(record.redirectUri) ?? undefined,
          scopes: normalizeScopeList(record.scopes),
          responseType: "code",
          responseMode: isOidcResponseMode(record.responseMode)
            ? record.responseMode
            : "query",
          pkce: true,
          tokenEndpoint: normalizeHttpUrl(record.tokenEndpoint) ?? undefined,
          userInfoEndpoint: normalizeHttpUrl(record.userInfoEndpoint) ?? undefined,
          jwksUri: normalizeHttpUrl(record.jwksUri) ?? undefined,
          clientSecretConfigured: record.clientSecretConfigured === true,
          roleClaim: trimText(record.roleClaim) || "realm_access.roles",
          defaultRole:
            isMemberRole(record.defaultRole) && record.defaultRole !== "owner"
              ? record.defaultRole
              : "member",
          allowOwnerRoleMapping: record.allowOwnerRoleMapping === true,
        } satisfies OidcProviderConfig,
      ]
    }

    if (record.type === "saml") {
      const ssoUrl = normalizeHttpUrl(record.ssoUrl)
      const acsUrl = normalizeHttpUrl(record.acsUrl)
      const entityId = trimText(record.entityId)

      if (!entityId || !ssoUrl || !acsUrl) {
        return []
      }

      return [
        {
          ...common,
          type: "saml",
          entityId,
          ssoUrl,
          acsUrl,
          certificateFingerprint:
            trimText(record.certificateFingerprint) || undefined,
        } satisfies SamlProviderConfig,
      ]
    }

    return []
  })
}

function normalizeSsoRoleMappings(
  value: unknown,
  providers: SsoProviderConfig[],
  workspaces: Workspace[]
): SsoRoleMapping[] {
  if (!Array.isArray(value)) {
    return []
  }

  const providerIds = new Set(providers.map((provider) => provider.id))
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id))

  return value.flatMap((item) => {
    const record = asRecord(item)
    const id = trimText(record?.id)
    const providerId = trimText(record?.providerId)
    const claim = record?.claim
    const value = trimText(record?.value)
    const workspaceId = trimText(record?.workspaceId) || null
    const claimName = trimText(record?.claimName) || undefined

    if (
      !record ||
      !id ||
      !providerIds.has(providerId) ||
      !isSsoRoleMappingClaim(claim) ||
      !value ||
      (workspaceId && !workspaceIds.has(workspaceId)) ||
      (claim === "claim" && !claimName)
    ) {
      return []
    }

    return [
      {
        id,
        providerId,
        workspaceId,
        claim,
        claimName,
        value,
        role: isMemberRole(record.role) ? record.role : "member",
        permissions: normalizePermissions(record.permissions),
        priority: normalizePriority(record.priority),
        createdAt: normalizeIsoDateTime(record.createdAt),
      },
    ]
  })
}

function normalizeSsoSessions(
  value: unknown,
  users: User[],
  providers: SsoProviderConfig[]
): SsoSession[] {
  if (!Array.isArray(value)) {
    return []
  }

  const userIds = new Set(users.map((user) => user.id))
  const providerIds = new Set(providers.map((provider) => provider.id))

  return value.flatMap((item) => {
    const record = asRecord(item)
    const id = trimText(record?.id)
    const providerId = trimText(record?.providerId)
    const userId = trimText(record?.userId)
    const subject = trimText(record?.subject)
    const email = normalizeEmail(record?.email)

    if (
      !record ||
      !id ||
      !providerIds.has(providerId) ||
      !userIds.has(userId) ||
      !subject ||
      !email
    ) {
      return []
    }

    return [
      {
        id,
        providerId,
        userId,
        subject,
        email,
        displayName: trimText(record.displayName) || undefined,
        groups: normalizeStringList(record.groups),
        roles: normalizeStringList(record.roles),
        claims: normalizeClaims(record.claims),
        issuedAt: normalizeIsoDateTime(record.issuedAt),
        expiresAt: normalizeOptionalIsoDateTime(record.expiresAt),
        lastSeenAt: normalizeIsoDateTime(record.lastSeenAt),
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
  workspaces: Workspace[],
  ssoSessions: SsoSession[]
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
    ...normalizeSessionAuth(record, userId, ssoSessions),
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
  return workspaceRoles.some((role) => role === value)
}

function isMemberStatus(value: unknown): value is WorkspaceMember["status"] {
  return value === "active" || value === "invited"
}

function isWorkspacePermission(value: unknown): value is WorkspacePermission {
  return workspacePermissions.some((permission) => permission === value)
}

function normalizePermissions(value: unknown): WorkspacePermission[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<WorkspacePermission>()
  const permissions: WorkspacePermission[] = []

  value.forEach((item) => {
    if (!isWorkspacePermission(item) || seen.has(item)) {
      return
    }

    seen.add(item)
    permissions.push(item)
  })

  return permissions
}

function isOidcResponseMode(value: unknown): value is OidcProviderConfig["responseMode"] {
  return value === "query" || value === "form_post"
}

function isSsoProviderKind(value: unknown): value is SsoProviderConfig["providerKind"] {
  return (
    value === "keycloak" ||
    value === "authentik" ||
    value === "oidc" ||
    value === "saml"
  )
}

function isSsoRoleMappingClaim(
  value: unknown
): value is SsoRoleMapping["claim"] {
  return (
    value === "email" ||
    value === "email_domain" ||
    value === "groups" ||
    value === "roles" ||
    value === "claim"
  )
}

function normalizePriority(value: unknown) {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN

  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

function normalizeDomainHint(value: unknown) {
  const domain = trimText(value).toLowerCase().replace(/^@/, "")

  return domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) ? domain : undefined
}

function normalizeClaims(value: unknown) {
  const record = asRecord(value)

  if (!record) {
    return {}
  }

  return Object.entries(record).reduce<Record<string, SsoClaimValue>>(
    (claims, [key, claimValue]) => {
      const claimName = trimText(key)
      const normalizedValue = normalizeClaimValue(claimValue)

      if (!claimName || normalizedValue === undefined) {
        return claims
      }

      claims[claimName] = normalizedValue
      return claims
    },
    {}
  )
}

function normalizeClaimValue(value: unknown): SsoClaimValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }

  if (!Array.isArray(value)) {
    return undefined
  }

  return normalizeStringList(value)
}

function normalizeSessionAuth(
  record: Record<string, unknown>,
  userId: string,
  ssoSessions: SsoSession[]
): Pick<AppSession, "authMethod" | "ssoSessionId" | "expiresAt"> {
  if (record.authMethod !== "sso") {
    return { authMethod: "local" }
  }

  const ssoSessionId = trimText(record.ssoSessionId)
  const ssoSession = ssoSessions.find(
    (session) => session.id === ssoSessionId && session.userId === userId
  )

  if (!ssoSession || isExpiredIsoDateTime(ssoSession.expiresAt)) {
    return { authMethod: "local" }
  }

  return {
    authMethod: "sso",
    ssoSessionId: ssoSession.id,
    expiresAt: ssoSession.expiresAt,
  }
}

function isExpiredIsoDateTime(value: string | undefined) {
  return Boolean(value && new Date(value).getTime() <= Date.now())
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
  const user = db.users.find(
    (item) =>
      item.email.toLowerCase() === email && (item.authProvider ?? "local") === "local"
  )

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

export function completeSsoLogin(
  db: AppDatabase,
  profile: SsoLoginProfile
): AuthResult {
  const provider = db.ssoProviders.find(
    (item): item is OidcProviderConfig =>
      item.id === profile.providerId &&
      item.type === "oidc" &&
      item.status === "enabled"
  )

  if (!provider) {
    return { ok: false, error: "SSO-провайдер не найден или отключен." }
  }

  const workspace = db.workspaces.find((item) => item.id === provider.workspaceId)

  if (!workspace) {
    return { ok: false, error: "Бюджет для SSO-провайдера не найден." }
  }

  const email = normalizeEmail(profile.email)
  const subject = trimText(profile.subject)
  const name = trimText(profile.name) || email?.split("@")[0] || "SSO пользователь"

  if (!email || !subject) {
    return { ok: false, error: "IdP не вернул стабильный subject и email." }
  }

  const now = new Date().toISOString()
  const groups = normalizeStringList(profile.groups)
  const roles = normalizeStringList(profile.roles)
  const claims = normalizeClaims(profile.claims)
  const mappedRole = resolveSsoRoleMapping(db.ssoRoleMappings, {
    providerId: provider.id,
    workspaceId: workspace.id,
    email,
    groups,
    roles,
    claims,
  })?.role
  const role = resolveSsoLoginRole(mappedRole, provider.defaultRole, provider)
  const existingUser = db.users.find(
    (user) =>
      user.authProvider === "sso" &&
      user.ssoProviderId === provider.id &&
      user.externalSubject === subject
  )
  const user: User = existingUser
    ? {
        ...existingUser,
        name,
        email,
        lastLoginAt: now,
      }
    : {
        id: createId("user"),
        name,
        email,
        passwordHash: "sso",
        authProvider: "sso",
        ssoProviderId: provider.id,
        externalSubject: subject,
        lastLoginAt: now,
        createdAt: now,
      }
  const linkedWorkspace = linkSsoMember(workspace, user, role)
  const ssoSession: SsoSession = {
    id: createId("sso_session"),
    providerId: provider.id,
    userId: user.id,
    subject,
    email,
    displayName: name,
    groups,
    roles,
    claims,
    issuedAt: now,
    expiresAt: normalizeOptionalIsoDateTime(profile.expiresAt),
    lastSeenAt: now,
  }
  const session: AppSession = {
    userId: user.id,
    activeWorkspaceId: workspace.id,
    authMethod: "sso",
    ssoSessionId: ssoSession.id,
    expiresAt: ssoSession.expiresAt,
  }
  const nextDb = normalizeDatabase({
    ...db,
    users: existingUser
      ? db.users.map((item) => (item.id === user.id ? user : item))
      : [...db.users, user],
    workspaces: db.workspaces.map((item) =>
      item.id === workspace.id ? linkedWorkspace : item
    ),
    ssoSessions: [
      ssoSession,
      ...db.ssoSessions.filter(
        (item) =>
          !(
            item.providerId === provider.id &&
            item.subject === subject &&
            item.userId === user.id
          )
      ),
    ].slice(0, 20),
    session,
  })

  return {
    ok: true,
    db: nextDb,
    session: nextDb.session ?? session,
  }
}

function resolveSsoLoginRole(
  mappedRole: WorkspaceRole | undefined,
  defaultRole: Exclude<WorkspaceRole, "owner">,
  provider: OidcProviderConfig
): WorkspaceRole {
  if (!mappedRole) {
    return defaultRole
  }

  if (mappedRole === "owner" && !provider.allowOwnerRoleMapping) {
    return defaultRole
  }

  return mappedRole
}

function linkSsoMember(
  workspace: Workspace,
  user: User,
  role: WorkspaceRole
): Workspace {
  const existingMember = workspace.members.find((member) => member.userId === user.id)
  const invitedMember = workspace.members.find(
    (member) => !member.userId && member.email.toLowerCase() === user.email
  )
  const keepExistingOwner =
    existingMember?.role === "owner" && workspace.ownerId === user.id
  const nextMemberRole = keepExistingOwner ? "owner" : role

  if (existingMember) {
    return {
      ...workspace,
      members: workspace.members.map((member) =>
        member.id === existingMember.id
          ? {
              ...member,
              name: user.name,
              email: user.email,
              role: nextMemberRole,
              status: "active",
            }
          : member
      ),
    }
  }

  if (invitedMember) {
    return {
      ...workspace,
      members: workspace.members.map((member) =>
        member.id === invitedMember.id
          ? {
              ...member,
              userId: user.id,
              name: user.name,
              email: user.email,
              role: nextMemberRole,
              status: "active",
            }
          : member
      ),
    }
  }

  return {
    ...workspace,
    members: [
      ...workspace.members,
      {
        id: createId("member"),
        userId: user.id,
        name: user.name,
        email: user.email,
        role: nextMemberRole,
        status: "active",
      },
    ],
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
