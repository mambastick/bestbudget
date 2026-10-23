import "server-only"
import { and, desc, eq, notExists, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { getDb, type DbOrTx } from "@/db"
import { auditLogs, users } from "@/db/schema"
import type { OidcRole } from "@/lib/oidc-roles"
import { audit } from "../audit"

const blockedAction = "oidc.role_demotion_blocked"
const resolvedAction = "oidc.role_demotion_resolved"

function pendingDemotion(userId?: string) {
  const resolved = alias(auditLogs, "resolved")
  return and(
    eq(auditLogs.action, blockedAction),
    userId ? eq(auditLogs.entityId, userId) : undefined,
    notExists(getDb().select({ id: resolved.id }).from(resolved).where(and(
      eq(resolved.action, resolvedAction),
      sql`${resolved.meta}->>'blockedEventId' = ${auditLogs.id}::text`,
    ))),
  )
}

/** Keep the role and its audit atomic, including concurrent callbacks on different replicas. */
export async function synchronizeOidcRole(userId: string, role: OidcRole, adminGroup: string) {
  return getDb().transaction(async (tx) => {
    // All OIDC role writes share this lock; the following statements get a fresh READ COMMITTED snapshot.
    await tx.execute(sql`select pg_advisory_xact_lock(7428302)`)
    const admins = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.role, "admin"), eq(users.banned, false))).orderBy(users.id).for("update")
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update")
    if (!user) return null

    if (user.role === "admin" && role === "user" && !admins.some((admin) => admin.id !== userId)) {
      await audit({ action: blockedAction, entityType: "user", entityId: userId, actorId: userId, meta: { adminGroup } }, tx)
      return user
    }

    const [updated] = await tx.update(users).set({ role }).where(eq(users.id, userId)).returning()
    await resolveDemotions(tx, userId)
    return updated ?? null
  })
}

async function resolveDemotions(tx: DbOrTx, userId: string) {
  const pending = await tx.select({ id: auditLogs.id }).from(auditLogs).where(pendingDemotion(userId))
  for (const event of pending) {
    // Link to each blocked attempt explicitly; transaction start timestamps may be out of order after waiting.
    await audit({ action: resolvedAction, entityType: "user", entityId: userId, actorId: userId, meta: { blockedEventId: event.id } }, tx)
  }
}

/** Show only unresolved attempts for accounts that still hold active administrator access. */
export async function hasOidcRoleDemotionWarning() {
  const [event] = await getDb().select({ id: auditLogs.id }).from(auditLogs)
    .innerJoin(users, eq(users.id, auditLogs.entityId))
    .where(and(pendingDemotion(), eq(users.role, "admin"), eq(users.banned, false)))
    .orderBy(desc(auditLogs.createdAt)).limit(1)
  return !!event
}
