import { workspacePermissions } from "./types"
import type {
  SsoClaims,
  SsoRoleMapping,
  WorkspaceMember,
  WorkspacePermission,
  WorkspaceRole,
} from "./types"

export const rolePermissionMatrix: Record<
  WorkspaceRole,
  readonly WorkspacePermission[]
> = {
  owner: workspacePermissions,
  admin: workspacePermissions,
  member: [
    "createTransactions",
    "manageLiabilities",
    "manageDocuments",
  ],
  observer: [],
}

export type SsoRoleMappingInput = {
  providerId: string
  workspaceId?: string | null
  email?: string | null
  groups?: string[]
  roles?: string[]
  claims?: SsoClaims
}

export type SsoRoleMappingResolution = {
  role: WorkspaceRole
  permissions: WorkspacePermission[]
  mapping: SsoRoleMapping
}

export function getRolePermissions(role: WorkspaceRole) {
  return [...rolePermissionMatrix[role]]
}

export function getMemberPermissions(member: WorkspaceMember | null | undefined) {
  if (!member || member.status !== "active") {
    return []
  }

  return mergePermissions(rolePermissionMatrix[member.role], member.permissions ?? [])
}

export function memberHasPermission(
  member: WorkspaceMember | null | undefined,
  permission: WorkspacePermission
) {
  return getMemberPermissions(member).includes(permission)
}

export function resolveSsoRoleMapping(
  mappings: SsoRoleMapping[],
  input: SsoRoleMappingInput
): SsoRoleMappingResolution | null {
  const matchedMapping =
    mappings
      .filter((mapping) => matchesSsoRoleMapping(mapping, input))
      .sort((left, right) => right.priority - left.priority)[0] ?? null

  if (!matchedMapping) {
    return null
  }

  return {
    role: matchedMapping.role,
    permissions: mergePermissions(
      rolePermissionMatrix[matchedMapping.role],
      matchedMapping.permissions ?? []
    ),
    mapping: matchedMapping,
  }
}

export function matchesSsoRoleMapping(
  mapping: SsoRoleMapping,
  input: SsoRoleMappingInput
) {
  if (mapping.providerId !== input.providerId) {
    return false
  }

  if (mapping.workspaceId && mapping.workspaceId !== input.workspaceId) {
    return false
  }

  const expected = normalizeComparable(mapping.value)

  switch (mapping.claim) {
    case "email":
      return normalizeComparable(input.email) === expected
    case "email_domain":
      return getEmailDomain(input.email) === expected.replace(/^@/, "")
    case "groups":
      return normalizeComparableList(input.groups).includes(expected)
    case "roles":
      return normalizeComparableList(input.roles).includes(expected)
    case "claim":
      return Boolean(
        mapping.claimName &&
          matchesClaimValue(input.claims?.[mapping.claimName], expected)
      )
  }
}

function mergePermissions(
  basePermissions: readonly WorkspacePermission[],
  extraPermissions: readonly WorkspacePermission[]
) {
  const permissions = new Set<WorkspacePermission>()

  basePermissions.forEach((permission) => permissions.add(permission))
  extraPermissions.forEach((permission) => permissions.add(permission))

  return [...permissions]
}

function normalizeComparable(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase()
}

function normalizeComparableList(value: string[] | undefined) {
  return (value ?? []).map(normalizeComparable).filter(Boolean)
}

function getEmailDomain(email: string | null | undefined) {
  const [, domain = ""] = normalizeComparable(email).split("@")

  return domain
}

function matchesClaimValue(value: SsoClaims[string] | undefined, expected: string) {
  if (Array.isArray(value)) {
    return normalizeComparableList(value).includes(expected)
  }

  if (value === null || value === undefined) {
    return false
  }

  return normalizeComparable(String(value)) === expected
}
