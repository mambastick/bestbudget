export type HouseholdRole = "owner" | "admin" | "member"

/**
 * Household permission matrix.
 * - member: creates, edits and views operations (incl. recurring ones);
 * - admin: plus categories, accounts, budgets and invitations;
 * - owner: plus members, roles and household settings.
 */
const MATRIX = {
  "finance.read": ["owner", "admin", "member"],
  "finance.write": ["owner", "admin", "member"],
  "loans.manage": ["owner", "admin"],
  "catalog.manage": ["owner", "admin"],
  "invitations.manage": ["owner", "admin"],
  "members.manage": ["owner"],
  "household.manage": ["owner"],
} as const satisfies Record<string, readonly HouseholdRole[]>

export type Permission = keyof typeof MATRIX

export function can(role: HouseholdRole, permission: Permission): boolean {
  return (MATRIX[permission] as readonly HouseholdRole[]).includes(role)
}

export const ROLE_LABELS: Record<HouseholdRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
}
