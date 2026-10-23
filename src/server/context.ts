import "server-only"

import type { HouseholdRole } from "@/domain/permissions"
import { can, type Permission } from "@/domain/permissions"
import { forbidden } from "./errors"

/** Resolved, membership-checked context for household-scoped operations. */
export interface HouseholdCtx {
  userId: string
  householdId: string
  role: HouseholdRole
  timezone: string
  currency: string
  locale?: string
}

export function assertCan(ctx: Pick<HouseholdCtx, "role">, permission: Permission) {
  if (!can(ctx.role, permission)) throw forbidden()
}
