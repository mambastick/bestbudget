import "server-only"
import { and, desc, eq, isNotNull } from "drizzle-orm"
import { getDb } from "@/db"
import { notificationDeliveries, telegramLinks } from "@/db/schema"
import { env } from "@/lib/env"
import type { HouseholdCtx } from "@/server/context"
import { getPreferences, listPushDevices } from "@/server/services/notifications"
import { telegramConfig, vapidConfig } from "@/server/services/notification-settings"

export async function notificationProfile(ctx: HouseholdCtx) {
  const [preferences, devices, links, vapid, c] = await Promise.all([
    getPreferences(ctx), listPushDevices(ctx.userId),
    getDb().select({ connected: telegramLinks.chatId }).from(telegramLinks).where(eq(telegramLinks.userId, ctx.userId)),
    vapidConfig(), telegramConfig(),
  ])
  return { preferences, devices: devices.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })), publicKey: vapid.publicKey,
    telegramConnected: Boolean(links[0]?.connected), botReady: Boolean(c.token && c.row.botUsername), timezone: ctx.timezone }
}
export async function notificationAdmin() {
  const [c, vapid, errors] = await Promise.all([
    telegramConfig(), vapidConfig(),
    getDb().select({ id: notificationDeliveries.id, channel: notificationDeliveries.channel, kind: notificationDeliveries.kind,
      status: notificationDeliveries.status, error: notificationDeliveries.error, attempts: notificationDeliveries.attempts, createdAt: notificationDeliveries.createdAt })
      .from(notificationDeliveries).where(and(isNotNull(notificationDeliveries.error))).orderBy(desc(notificationDeliveries.createdAt)).limit(30),
  ])
  return { fromEnv: Boolean(env().TELEGRAM_BOT_TOKEN), modeFromEnv: Boolean(env().TELEGRAM_MODE), enabled: Boolean(c.token), mode: c.mode === "webhook" ? "webhook" as const : "polling" as const,
    username: c.row.botUsername, version: c.row.version, lastUpdate: c.row.lastUpdateAt?.toISOString() ?? null,
    transportError: c.row.transportError, publicKey: vapid.publicKey, jobsEnabled: env().JOBS_ENABLED !== "false",
    errors: errors.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })) }
}
