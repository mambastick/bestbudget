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

export type AuthProvider = "local" | "sso"

export const workspaceRoles = ["owner", "admin", "member", "observer"] as const

export type WorkspaceRole = (typeof workspaceRoles)[number]

export const workspacePermissions = [
  "createTransactions",
  "manageBudgets",
  "manageLiabilities",
  "manageDocuments",
  "manageMembers",
  "manageSso",
] as const

export type WorkspacePermission = (typeof workspacePermissions)[number]

export type SsoProviderStatus = "enabled" | "disabled"

export type SsoProviderKind = "keycloak" | "authentik" | "oidc" | "saml"

export type OidcResponseMode = "query" | "form_post"

export type SsoProviderBase = {
  id: string
  workspaceId: string
  type: "oidc" | "saml"
  providerKind: SsoProviderKind
  name: string
  status: SsoProviderStatus
  domainHint?: string
  createdAt: string
  updatedAt?: string
}

export type OidcProviderConfig = SsoProviderBase & {
  type: "oidc"
  issuer: string
  clientId: string
  authorizationEndpoint?: string
  redirectUri?: string
  scopes: string[]
  responseType: "code"
  responseMode: OidcResponseMode
  pkce: true
  tokenEndpoint?: string
  userInfoEndpoint?: string
  jwksUri?: string
  clientSecretConfigured?: boolean
  roleClaim: string
  defaultRole: Exclude<WorkspaceRole, "owner">
  allowOwnerRoleMapping: boolean
}

export type SamlProviderConfig = SsoProviderBase & {
  type: "saml"
  entityId: string
  ssoUrl: string
  acsUrl: string
  certificateFingerprint?: string
}

export type SsoProviderConfig = OidcProviderConfig | SamlProviderConfig

export type SsoClaimValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | Record<string, unknown>

export type SsoClaims = Record<string, SsoClaimValue>

export type SsoRoleMappingClaim =
  | "email"
  | "email_domain"
  | "groups"
  | "roles"
  | "claim"

export type SsoRoleMapping = {
  id: string
  providerId: string
  workspaceId: string | null
  claim: SsoRoleMappingClaim
  claimName?: string
  value: string
  role: WorkspaceRole
  permissions?: WorkspacePermission[]
  priority: number
  createdAt: string
}

export type SsoSession = {
  id: string
  providerId: string
  userId: string
  subject: string
  email: string
  displayName?: string
  groups: string[]
  roles: string[]
  claims: SsoClaims
  issuedAt: string
  expiresAt?: string
  lastSeenAt: string
}

export type User = {
  id: string
  name: string
  email: string
  passwordHash: string
  authProvider?: AuthProvider
  ssoProviderId?: string
  externalSubject?: string
  lastLoginAt?: string
  createdAt: string
}

export type WorkspaceMember = {
  id: string
  userId: string | null
  name: string
  email: string
  role: WorkspaceRole
  status: "active" | "invited"
  permissions?: WorkspacePermission[]
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
  authMethod?: "local" | "sso"
  ssoSessionId?: string
  expiresAt?: string
}

export type AppDatabase = {
  version: 1
  users: User[]
  workspaces: Workspace[]
  ssoProviders: SsoProviderConfig[]
  ssoRoleMappings: SsoRoleMapping[]
  ssoSessions: SsoSession[]
  categories: Category[]
  transactions: Transaction[]
  budgets: Budget[]
  liabilities: Liability[]
  documents: DocumentRecord[]
  session: AppSession | null
}
