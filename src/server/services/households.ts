import "server-only"
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { categories, financialAccounts, householdMembers, households, invitations, users } from "@/db/schema"
import { householdDefaults } from "@/domain/defaults"
import type { HouseholdRole } from "@/domain/permissions"
import { hashToken, randomToken } from "@/lib/crypto"
import { CURRENCY_CODES } from "@/lib/currencies"
import { isValidTimeZone } from "@/lib/dates"
import { audit } from "../audit"
import { assertCan, type HouseholdCtx } from "../context"
import { AppError, conflict, notFound } from "../errors"

const timezone = z.string().refine(isValidTimeZone, "validation.timezone")
const memberIdSchema = z.uuid("validation.id")

export const householdInput = z.object({
  name: z.string().trim().min(1, "validation.titleRequired").max(80),
  currency: z.enum(CURRENCY_CODES).optional(),
  timezone: timezone.default("Europe/Moscow"),
})

export async function createHousehold(userId: string, raw: z.input<typeof householdInput>, locale = "ru") {
  const defaults = householdDefaults(locale)
  const input = householdInput.parse(raw)
  return getDb().transaction(async (tx) => {
    const [household] = await tx
      .insert(households)
      .values({ name: input.name, timezone: input.timezone, currency: input.currency ?? "RUB", createdBy: userId })
      .returning()
    const id = household!.id
    await tx.insert(householdMembers).values({ householdId: id, userId, role: "owner" })
    await tx.insert(categories).values([
      ...defaults.income.map((c, i) => ({ ...c, householdId: id, kind: "income" as const, sortOrder: i })),
      ...defaults.expense.map((c, i) => ({ ...c, householdId: id, kind: "expense" as const, sortOrder: i })),
    ])
    await tx.insert(financialAccounts).values({ householdId: id, name: defaults.accountName, kind: "debit_card", currency: input.currency ?? "RUB" })
    await audit({ action: "household.create", entityType: "household", entityId: id, householdId: id, actorId: userId }, tx)
    return household!
  })
}

export async function listMemberships(userId: string) {
  return getDb()
    .select({
      id: households.id,
      name: households.name,
      role: householdMembers.role,
      timezone: households.timezone,
      currency: households.currency,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, userId))
    .orderBy(asc(householdMembers.joinedAt))
}

/** The only way to obtain a HouseholdCtx: it proves the user is a member of the household. */
export async function resolveHouseholdCtx(userId: string, householdId: string): Promise<HouseholdCtx | null> {
  if (!z.uuid().safeParse(householdId).success) return null
  const [row] = await getDb()
    .select({ role: householdMembers.role, timezone: households.timezone, currency: households.currency })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
  if (!row) return null
  return { userId, householdId, role: row.role, timezone: row.timezone, currency: row.currency }
}

export async function getHousehold(ctx: HouseholdCtx) {
  const [row] = await getDb().select().from(households).where(eq(households.id, ctx.householdId))
  if (!row) throw notFound("household.notFound")
  return row
}

export async function updateHousehold(ctx: HouseholdCtx, raw: z.input<typeof householdInput> & { version?: number }) {
  assertCan(ctx, "household.manage")
  const input = householdInput.parse(raw)
  const before = await getHousehold(ctx)
  const version = z.number().int().positive().parse(raw.version ?? before.version)
  const updated = await getDb().update(households).set({ ...input, version: sql`${households.version} + 1` }).where(and(eq(households.id, ctx.householdId), eq(households.version, version))).returning()
  if (!updated.length) throw conflict()
  await audit({ action: "household.update", entityType: "household", entityId: ctx.householdId, householdId: ctx.householdId, actorId: ctx.userId, meta: input })
}

export async function deleteHousehold(ctx: HouseholdCtx, confirmName: string) {
  assertCan(ctx, "household.manage")
  const household = await getHousehold(ctx)
  if (household.name.trim() !== confirmName.trim()) throw new AppError("household.nameMismatch")
  await getDb().delete(households).where(eq(households.id, ctx.householdId))
  await audit({ action: "household.delete", entityType: "household", entityId: ctx.householdId, actorId: ctx.userId, meta: { name: household.name } })
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listMembers(ctx: HouseholdCtx) {
  return getDb()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: householdMembers.role,
      joinedAt: householdMembers.joinedAt,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, ctx.householdId))
    .orderBy(asc(householdMembers.joinedAt))
}

export async function changeMemberRole(ctx: HouseholdCtx, rawUserId: string, rawRole: HouseholdRole) {
  assertCan(ctx, "members.manage")
  const targetId = memberIdSchema.parse(rawUserId)
  const role = z.enum(["owner", "admin", "member"]).parse(rawRole)
  if (role === "owner") throw new AppError("household.useTransferOwnership")
  if (targetId === ctx.userId) throw new AppError("household.selfRoleChange")
  const res = await getDb()
    .update(householdMembers)
    .set({ role })
    .where(and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.userId, targetId)))
    .returning()
  if (res.length === 0) throw notFound("household.memberNotFound")
  await audit({ action: "member.role", entityType: "user", entityId: targetId, householdId: ctx.householdId, actorId: ctx.userId, meta: { role } })
}

export async function transferOwnership(ctx: HouseholdCtx, rawUserId: string) {
  assertCan(ctx, "members.manage")
  const targetId = memberIdSchema.parse(rawUserId)
  if (targetId === ctx.userId) return
  await getDb().transaction(async (tx) => {
    const res = await tx
      .update(householdMembers)
      .set({ role: "owner" })
      .where(and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.userId, targetId)))
      .returning()
    if (res.length === 0) throw notFound("household.memberNotFound")
    await tx
      .update(householdMembers)
      .set({ role: "admin" })
      .where(and(eq(householdMembers.householdId, ctx.householdId), eq(householdMembers.userId, ctx.userId)))
    await audit({ action: "member.transfer_ownership", entityType: "user", entityId: targetId, householdId: ctx.householdId, actorId: ctx.userId }, tx)
  })
}

export async function removeMember(ctx: HouseholdCtx, rawUserId: string) {
  const targetId = memberIdSchema.parse(rawUserId)
  const self = targetId === ctx.userId
  if (!self) assertCan(ctx, "members.manage")
  if (self && ctx.role === "owner") throw new AppError("household.ownerCannotLeave")
  const res = await getDb()
    .delete(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, ctx.householdId),
        eq(householdMembers.userId, targetId),
        // The owner can never be removed by anyone.
        sql`${householdMembers.role} <> 'owner'`,
      ),
    )
    .returning()
  if (res.length === 0) throw notFound("household.memberNotFound")
  await audit({ action: self ? "member.leave" : "member.remove", entityType: "user", entityId: targetId, householdId: ctx.householdId, actorId: ctx.userId })
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export const invitationInput = z.object({
  role: z.enum(["admin", "member"]).default("member"),
  note: z.string().trim().max(100).optional(),
  ttlDays: z.coerce.number().int().min(1).max(30).default(7),
})

/** Creates a one-time invitation. The raw token is returned once and only its hash is stored. */
export async function createInvitation(ctx: HouseholdCtx, raw: z.input<typeof invitationInput>) {
  assertCan(ctx, "invitations.manage")
  const input = invitationInput.parse(raw)
  const token = randomToken()
  const [row] = await getDb()
    .insert(invitations)
    .values({
      householdId: ctx.householdId,
      tokenHash: hashToken(token),
      role: input.role,
      note: input.note || null,
      createdBy: ctx.userId,
      expiresAt: new Date(Date.now() + input.ttlDays * 86_400_000),
    })
    .returning({ id: invitations.id, expiresAt: invitations.expiresAt })
  await audit({ action: "invitation.create", entityType: "invitation", entityId: row!.id, householdId: ctx.householdId, actorId: ctx.userId, meta: { role: input.role } })
  return { id: row!.id, token, expiresAt: row!.expiresAt }
}

export async function listInvitations(ctx: HouseholdCtx) {
  assertCan(ctx, "invitations.manage")
  return getDb()
    .select({ id: invitations.id, role: invitations.role, note: invitations.note, expiresAt: invitations.expiresAt, createdAt: invitations.createdAt })
    .from(invitations)
    .where(
      and(
        eq(invitations.householdId, ctx.householdId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(invitations.createdAt))
}

export async function revokeInvitation(ctx: HouseholdCtx, rawId: string) {
  assertCan(ctx, "invitations.manage")
  const id = z.uuid().parse(rawId)
  const res = await getDb()
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, id), eq(invitations.householdId, ctx.householdId), isNull(invitations.acceptedAt)))
    .returning()
  if (res.length === 0) throw notFound("invite.notFound")
  await audit({ action: "invitation.revoke", entityType: "invitation", entityId: id, householdId: ctx.householdId, actorId: ctx.userId })
}

/** Looks up a still-usable invitation by its raw token. */
export async function findValidInvitation(token: string) {
  if (!token || token.length > 100) return null
  const [row] = await getDb()
    .select({ id: invitations.id, role: invitations.role, householdId: invitations.householdId, householdName: households.name, expiresAt: invitations.expiresAt })
    .from(invitations)
    .innerJoin(households, eq(households.id, invitations.householdId))
    .where(
      and(
        eq(invitations.tokenHash, hashToken(token)),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
  return row ?? null
}

/**
 * Accepts an invitation for `userId`. The invitation row is locked so that a token
 * can be consumed only once even under concurrent requests.
 */
export async function acceptInvitation(userId: string, token: string) {
  return getDb().transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, hashToken(token)))
      .for("update")
    if (!inv || inv.revokedAt || inv.acceptedAt || inv.expiresAt <= new Date()) {
      throw new AppError("invite.invalid", {}, "not_found")
    }
    const [existing] = await tx
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, inv.householdId), eq(householdMembers.userId, userId)))
    if (existing) return { householdId: inv.householdId, alreadyMember: true }

    await tx.insert(householdMembers).values({ householdId: inv.householdId, userId, role: inv.role })
    await tx.update(invitations).set({ acceptedAt: new Date(), acceptedBy: userId }).where(eq(invitations.id, inv.id))
    await audit({ action: "invitation.accept", entityType: "invitation", entityId: inv.id, householdId: inv.householdId, actorId: userId }, tx)
    return { householdId: inv.householdId, alreadyMember: false }
  })
}
