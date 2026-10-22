import "server-only"
import { and, eq, like, lt, ne, or } from "drizzle-orm"
import { getDb } from "@/db"
import { notificationDeliveries, notificationPreferences, notificationSettings, pushSubscriptions, telegramLinks, users } from "@/db/schema"
import { preferencesInput, scheduledNotices, type Notice } from "@/domain/notifications"
import { can } from "@/domain/permissions"
import { todayIn } from "@/lib/dates"
import { resolveHouseholdCtx } from "@/server/services/households"
import { configureTelegramTransport } from "@/server/services/notification-settings"
import { ensureMaterialized } from "@/server/services/recurring"
import { deliverOnce, sendPushNotice, sendTelegramNotice } from "@/server/notifications/delivery"
import { notificationSnapshot } from "@/server/notifications/snapshot"
import { pollTelegram } from "@/server/notifications/telegram"
import { DeliveryError } from "@/server/notifications/telegram-api"

/** Caller holds the scheduler advisory lock. No payload is persisted or written to server logs. */
export async function runNotificationJob(now = new Date()) {
  const db = getDb()
  await db.update(notificationDeliveries).set({ status: "unknown", error: "delivery_unknown" }).where(and(eq(notificationDeliveries.status, "sending"), lt(notificationDeliveries.createdAt, new Date(now.getTime() - 300_000))))
  let telegram: Awaited<ReturnType<typeof configureTelegramTransport>> = null
  try { telegram = await configureTelegramTransport() }
  catch (e) { await db.update(notificationSettings).set({ transportError: e instanceof DeliveryError ? e.code : "telegram_configuration" }).where(eq(notificationSettings.id, 1)) }
  const preferences = await db.select({ p: notificationPreferences }).from(notificationPreferences).innerJoin(users, eq(users.id, notificationPreferences.userId)).where(eq(users.banned, false))
  const materialized = new Set<string>()
  let count = 0
  for (const { p } of preferences) {
    if (!p.telegram && !p.push) continue
    const ctx = await resolveHouseholdCtx(p.userId, p.householdId)
    if (!ctx || !can(ctx.role, "finance.read")) continue
    try {
      if (!materialized.has(ctx.householdId)) {
        await ensureMaterialized(ctx.householdId, todayIn(ctx.timezone, now))
        materialized.add(ctx.householdId)
      }
      const snapshot = await notificationSnapshot(ctx, now)
      const preferences = preferencesInput.parse(p)
      const noticeBatch = async (channel: string, suffix = "") => {
        const currentKey = `digest:${p.householdId}:${todayIn(ctx.timezone, now)}${suffix}`
        const delivered = await db.select({ key: notificationDeliveries.dedupeKey, budgetKeys: notificationDeliveries.budgetKeys }).from(notificationDeliveries)
          .where(and(eq(notificationDeliveries.userId, p.userId), eq(notificationDeliveries.householdId, p.householdId), eq(notificationDeliveries.channel, channel),
            or(eq(notificationDeliveries.status, "sent"), eq(notificationDeliveries.status, "unknown"), eq(notificationDeliveries.status, "sending")), ne(notificationDeliveries.dedupeKey, currentKey),
            suffix ? like(notificationDeliveries.dedupeKey, `%${suffix}`) : undefined))
        const suppressed = new Set(delivered.flatMap((d) => [...d.budgetKeys, d.key.replace(/:device:.*$/, "")]))
        return scheduledNotices(snapshot, preferences, ctx.timezone, now, suppressed)
      }
      const [link] = p.telegram ? await db.select().from(telegramLinks).where(eq(telegramLinks.userId, p.userId)) : []
      const devices = p.push ? await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, p.userId)) : []
      const targets = [
        ...(p.telegram && link?.chatId && telegram?.token ? [{ channel: "telegram", suffix: "", send: (notice: Notice) => sendTelegramNotice(telegram.token!, link.chatId!, notice) }] : []),
        ...devices.map((device) => ({ channel: "push", suffix: `:device:${device.id}`, send: (notice: Notice) => sendPushNotice(device, notice) })),
      ]
      for (const target of targets) {
        for (const notice of await noticeBatch(target.channel, target.suffix)) {
          // Re-check before each side effect; revocation must not drain a stale outbox.
          const current = await resolveHouseholdCtx(p.userId, p.householdId)
          const [active] = await db.select({ banned: users.banned, version: notificationPreferences.version }).from(notificationPreferences).innerJoin(users, eq(users.id, notificationPreferences.userId))
            .where(and(eq(notificationPreferences.userId, p.userId), eq(notificationPreferences.householdId, p.householdId)))
          if (!current || !can(current.role, "finance.read") || !active || active.banned || active.version !== p.version) break
          const prepared = { ...notice, text: `${snapshot.name}
${notice.text}`, path: `/api/notifications/open?household=${p.householdId}&page=${encodeURIComponent(notice.path)}` }
          const attempted = await deliverOnce({ userId: p.userId, householdId: p.householdId, channel: target.channel, notice: prepared, suffix: target.suffix }, () => target.send(prepared), now)
          if (attempted) count++
          if (count >= 250) break
        }
        if (count >= 250) break
      }
    } catch {
      // Isolate a household failure; detailed financial query errors must never reach the log.
      console.error("[jobs] notification household failed")
    }
    if (count >= 250) break
  }
  if (telegram?.mode === "polling") {
    try {
      await pollTelegram(telegram)
      await db.update(notificationSettings).set({ transportError: null }).where(eq(notificationSettings.id, 1))
    }
    catch (e) { await db.update(notificationSettings).set({ transportError: e instanceof DeliveryError ? e.code : "telegram_update" }).where(eq(notificationSettings.id, 1)) }
  }
}
