export type OidcRole = "admin" | "user"

export interface OidcRoleMapping {
  claim: string
  userGroup: string
  adminGroup: string
}

/** Exact, top-level group claims only. Neither provider roles nor client input are trusted. */
export function roleFromOidcGroups(profile: Record<string, unknown> | undefined, mapping: OidcRoleMapping): OidcRole | null {
  const groups = profile?.[mapping.claim]
  if (!Array.isArray(groups) || !groups.every((group) => typeof group === "string")) return null
  if (groups.includes(mapping.adminGroup)) return "admin"
  if (groups.includes(mapping.userGroup)) return "user"
  return null
}
