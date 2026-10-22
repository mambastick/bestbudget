import "server-only"
import { and, eq, like, lt, ne, or } from "drizzle-orm"
import { getDb } from "@/db"
import {
  notificationDeliveries,
  notificationPreferences,
  notificationSettings,
  pushSubscriptions,
  telegramLinks,
  users,
} from "@/db/schema"
import { preferencesInput, scheduledNotices, type Notice } from "@/domain/notifications"
import { can } from "@/domain/permissions"
import { todayIn } from "@/lib/dates"
import { resolveHouseholdCtx } from "@/server/services/households"
import { telegramConfig, telegramTransportReady, type TelegramConfig } from "@/server/services/notification-settings"
import { ensureMaterialized } from "@/server/services/recurring"
import { deliverOnce, sendPushNotice, sendTelegramNotice } from "@/server/notifications/delivery"
import { notificationSnapshot } from "@/server/notifications/snapshot"
import { DeliveryError } from "@/server/notifications/telegram-api"

type PreferenceRow = typeof notificationPreferences.$inferSelect
interface DeliveryTarget {
  channel: string
  suffix: string
  send: (notice: Notice) => Promise<void>
}

async function markInterruptedDeliveries(now: Date) {
  await getDb()
    .update(notificationDeliveries)
    .set({ status: "unknown", error: "delivery_unknown" })
    .where(
      and(
        eq(notificationDeliveries.status, "sending"),
        lt(notificationDeliveries.createdAt, new Date(now.getTime() - 300_000)),
      ),
    )
}

async function loadTelegramConfig() {
  try {
    const config = await telegramConfig()
    return telegramTransportReady(config) ? config : null
  } catch (error) {
    await getDb()
      .update(notificationSettings)
      .set({ transportError: error instanceof DeliveryError ? error.code : "telegram_configuration" })
      .where(eq(notificationSettings.id, 1))
    return null
  }
}

async function loadSuppressedKeys(p: PreferenceRow, target: DeliveryTarget, today: string) {
  const currentKey = `digest:${p.householdId}:${today}${target.suffix}`
  const delivered = await getDb()
    .select({ key: notificationDeliveries.dedupeKey, budgetKeys: notificationDeliveries.budgetKeys })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.userId, p.userId),
        eq(notificationDeliveries.householdId, p.householdId),
        eq(notificationDeliveries.channel, target.channel),
        or(
          eq(notificationDeliveries.status, "sent"),
          eq(notificationDeliveries.status, "unknown"),
          eq(notificationDeliveries.status, "sending"),
        ),
        ne(notificationDeliveries.dedupeKey, currentKey),
        target.suffix ? like(notificationDeliveries.dedupeKey, `%${target.suffix}`) : undefined,
      ),
    )
  return new Set(delivered.flatMap((d) => [...d.budgetKeys, d.key.replace(/:device:.*$/, "")]))
}

async function buildTargets(p: PreferenceRow, telegram: TelegramConfig | null) {
  const db = getDb()
  const [link] = p.telegram ? await db.select().from(telegramLinks).where(eq(telegramLinks.userId, p.userId)) : []
  const devices = p.push ? await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, p.userId)) : []
  const targets: DeliveryTarget[] = []
  if (p.telegram && link?.chatId && telegram?.token) {
    const token = telegram.token
    const chatId = link.chatId
    targets.push({
      channel: "telegram",
      suffix: "",
      send: (notice) => sendTelegramNotice(token, chatId, notice),
    })
  }
  for (const device of devices) {
    targets.push({
      channel: "push",
      suffix: `:device:${device.id}`,
      send: (notice) => sendPushNotice(device, notice),
    })
  }
  return targets
}

async function stillAllowed(p: PreferenceRow) {
  const current = await resolveHouseholdCtx(p.userId, p.householdId)
  const [active] = await getDb()
    .select({ banned: users.banned, version: notificationPreferences.version })
    .from(notificationPreferences)
    .innerJoin(users, eq(users.id, notificationPreferences.userId))
    .where(and(eq(notificationPreferences.userId, p.userId), eq(notificationPreferences.householdId, p.householdId)))
  return Boolean(
    current && can(current.role, "finance.read") && active && !active.banned && active.version === p.version,
  )
}

/** Caller holds the scheduler advisory lock. No payload is persisted or written to server logs. */
export async function runNotificationJob(now = new Date()) {
  await markInterruptedDeliveries(now)
  const telegram = await loadTelegramConfig()
  const preferences = await getDb()
    .select({ p: notificationPreferences })
    .from(notificationPreferences)
    .innerJoin(users, eq(users.id, notificationPreferences.userId))
    .where(eq(users.banned, false))
  const materialized = new Set<string>()
  let count = 0

  for (const { p } of preferences) {
    if (!p.telegram && !p.push) continue
    const ctx = await resolveHouseholdCtx(p.userId, p.householdId)
    if (!ctx || !can(ctx.role, "finance.read")) continue
    try {
      const today = todayIn(ctx.timezone, now)
      if (!materialized.has(ctx.householdId)) {
        await ensureMaterialized(ctx.householdId, today)
        materialized.add(ctx.householdId)
      }
      const snapshot = await notificationSnapshot(ctx, now)
      const settings = preferencesInput.parse(p)
      for (const target of await buildTargets(p, telegram)) {
        const suppressed = await loadSuppressedKeys(p, target, today)
        const notices = scheduledNotices(snapshot, settings, ctx.timezone, now, suppressed)
        for (const notice of notices) {
          // Re-check before each side effect; revocation must not drain a stale outbox.
          if (!(await stillAllowed(p))) break
          const prepared = {
            ...notice,
            text: `${snapshot.name}\n${notice.text}`,
            path: `/api/notifications/open?household=${p.householdId}&page=${encodeURIComponent(notice.path)}`,
          }
          const attempted = await deliverOnce(
            {
              userId: p.userId,
              householdId: p.householdId,
              channel: target.channel,
              notice: prepared,
              suffix: target.suffix,
            },
            () => target.send(prepared),
            now,
          )
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
}
