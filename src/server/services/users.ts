import "server-only"
import { count, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { auditLogs, authAccounts, householdMembers, households, sessions, users } from "@/db/schema"

export async function adminExists() {
  const [row] = await getDb().select({ n: count() }).from(users).where(eq(users.role, "admin"))
  return (row?.n ?? 0) > 0
}

export async function countAdmins() {
  const [row] = await getDb().select({ n: count() }).from(users).where(eq(users.role, "admin"))
  return row?.n ?? 0
}

export async function getLoginProviders(userId: string) {
  const rows = await getDb().select({ providerId: authAccounts.providerId }).from(authAccounts).where(eq(authAccounts.userId, userId))
  return rows.map((r) => r.providerId)
}

/** System admin view of users: identity and status only, no financial data. */
export async function listUsersForAdmin() {
  const db = getDb()
  const rows = await db.select().from(users).orderBy(desc(users.createdAt))
  if (rows.length === 0) return []
  const ids = rows.map((u) => u.id)
  const [providers, memberships, lastSessions] = await Promise.all([
    db.select({ userId: authAccounts.userId, providerId: authAccounts.providerId }).from(authAccounts).where(inArray(authAccounts.userId, ids)),
    db.select({ userId: householdMembers.userId, n: count() }).from(householdMembers).where(inArray(householdMembers.userId, ids)).groupBy(householdMembers.userId),
    db
      .select({ userId: sessions.userId, last: sql<Date>`max(${sessions.updatedAt})` })
      .from(sessions)
      .where(inArray(sessions.userId, ids))
      .groupBy(sessions.userId),
  ])
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    banned: u.banned,
    createdAt: u.createdAt,
    providers: providers.filter((p) => p.userId === u.id).map((p) => p.providerId),
    households: memberships.find((m) => m.userId === u.id)?.n ?? 0,
    lastSeen: lastSessions.find((s) => s.userId === u.id)?.last ?? null,
  }))
}

/** Households as seen by the system admin: metadata only, never balances or operations. */
export async function listHouseholdsForAdmin() {
  const db = getDb()
  const rows = await db
    .select({
      id: households.id,
      name: households.name,
      timezone: households.timezone,
      currency: households.currency,
      createdAt: households.createdAt,
      members: count(householdMembers.userId),
    })
    .from(households)
    .leftJoin(householdMembers, eq(householdMembers.householdId, households.id))
    .groupBy(households.id)
    .orderBy(desc(households.createdAt))
  const owners = await db
    .select({ householdId: householdMembers.householdId, name: users.name, email: users.email })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.role, "owner"))
  return rows.map((h) => ({ ...h, owner: owners.find((o) => o.householdId === h.id) ?? null }))
}

/** System-level events (auth, settings, administration) — household financial events are excluded. */
export async function listSystemEvents(limit = 100) {
  return getDb()
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      meta: auditLogs.meta,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(isNull(auditLogs.householdId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit)
}
