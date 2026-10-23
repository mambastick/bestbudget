import "server-only"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { notificationPreferences, pushSubscriptions, telegramLinks } from "@/db/schema"
import { preferencesInput } from "@/domain/notifications"
import { encryptSecret } from "@/lib/crypto"
import { audit } from "@/server/audit"
import { assertCan, type HouseholdCtx } from "@/server/context"
import { AppError, conflict } from "@/server/errors"

export async function getPreferences(ctx: HouseholdCtx) {
  assertCan(ctx, "finance.read")
  const [row] = await getDb()
    .select()
    .from(notificationPreferences)
    .where(
      and(eq(notificationPreferences.userId, ctx.userId), eq(notificationPreferences.householdId, ctx.householdId)),
    )
  return preferencesInput.parse(row ?? {})
}

export async function savePreferences(ctx: HouseholdCtx, raw: z.input<typeof preferencesInput>) {
  assertCan(ctx, "finance.read")
  const { version, ...input } = preferencesInput.parse(raw)
  const db = getDb()
  const rows =
    version === 0
      ? await db
          .insert(notificationPreferences)
          .values({ ...input, userId: ctx.userId, householdId: ctx.householdId })
          .onConflictDoNothing()
          .returning()
      : await db
          .update(notificationPreferences)
          .set({ ...input, version: sql`${notificationPreferences.version} + 1` })
          .where(
            and(
              eq(notificationPreferences.userId, ctx.userId),
              eq(notificationPreferences.householdId, ctx.householdId),
              eq(notificationPreferences.version, version),
            ),
          )
          .returning()
  if (!rows.length) throw conflict()
  await audit({
    action: "notifications.preferences.update",
    entityType: "notification_preferences",
    householdId: ctx.householdId,
    actorId: ctx.userId,
  })
  return preferencesInput.parse(rows[0])
}

/** Browser push services only: arbitrary URLs must never become an SSRF transport. */
export function allowedPushEndpoint(value: string) {
  try {
    const u = new URL(value)
    const hosts = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.apple.com", "notify.windows.com"]
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.port &&
      hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
    )
  } catch {
    return false
  }
}
export const subscriptionInput = z.object({
  endpoint: z.string().max(4096).refine(allowedPushEndpoint, "validation.pushService"),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }),
})
export async function subscribePush(userId: string, raw: z.input<typeof subscriptionInput>, userAgent: string) {
  const s = subscriptionInput.parse(raw)
  const db = getDb()
  const [existing] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, s.endpoint))
  if (existing && existing.userId !== userId)
    throw new AppError("notifications.subscriptionOwner")
  const keys = { p256dh: s.keys.p256dh, auth: encryptSecret(s.keys.auth) }
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint: s.endpoint, ...keys, userAgent: userAgent.slice(0, 300) })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: keys,
      setWhere: eq(pushSubscriptions.userId, userId),
    })
}
export async function removePush(userId: string, id: string) {
  await getDb()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, z.uuid().parse(id)), eq(pushSubscriptions.userId, userId)))
}
export async function listPushDevices(userId: string) {
  return getDb()
    .select({
      id: pushSubscriptions.id,
      userAgent: pushSubscriptions.userAgent,
      createdAt: pushSubscriptions.createdAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
}
export async function disconnectTelegram(userId: string) {
  await getDb().delete(telegramLinks).where(eq(telegramLinks.userId, userId))
  await audit({ action: "notifications.telegram.disconnect", entityType: "telegram_link", actorId: userId })
}
