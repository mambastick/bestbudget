import "server-only"
import { and, eq, lte, sql } from "drizzle-orm"
import webpush from "web-push"
import { getDb } from "@/db"
import { notificationDeliveries, pushSubscriptions } from "@/db/schema"
import { truncateMessage, type Notice } from "@/domain/notifications"
import { decryptSecret } from "@/lib/crypto"
import { appUrl } from "@/lib/env"
import { allowedPushEndpoint } from "@/server/services/notifications"
import { vapidConfig } from "@/server/services/notification-settings"
import { DeliveryError, telegramApi } from "./telegram-api"

export async function sendTelegramNotice(token: string, chatId: string, notice: Notice) {
  const url = `${appUrl()}${notice.path}`
  // Telegram rejects non-public HTTP URLs in inline buttons; local installs still get a text link.
  const keyboard = [
    ...(notice.payment ? [{ text: "✅ Оплачено", callback_data: `pay:${notice.payment.id}:${notice.payment.version}` }] : []),
    ...(url.startsWith("https://") ? [{ text: "Открыть", url }] : []),
  ]
  await telegramApi(token, "sendMessage", { chat_id: chatId, text: truncateMessage(`${notice.text}\n${url}`, 4096), link_preview_options: { is_disabled: true },
    ...(keyboard.length ? { reply_markup: { inline_keyboard: [keyboard] } } : {}) })
}
export async function sendPushNotice(subscription: typeof pushSubscriptions.$inferSelect, notice: Notice) {
  if (!allowedPushEndpoint(subscription.endpoint)) throw new DeliveryError("push_endpoint_invalid")
  const vapid = await vapidConfig()
  try {
    await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: decryptSecret(subscription.auth) } },
      JSON.stringify({ title: "BestBudget", body: truncateMessage(notice.text, 1000), url: notice.path, tag: notice.key }),
      { vapidDetails: vapid, TTL: 3600, timeout: 10_000 })
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) await getDb().delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id))
    throw new DeliveryError(status ? `push_${status}` : "push_unknown", status === 429 || (status !== undefined && status >= 500))
  }
}

/** Persist the claim before the side effect. Ambiguous outcomes are terminal to prevent restart duplicates. */
export async function deliverOnce(input: { userId: string; householdId: string; channel: string; notice: Notice; suffix?: string }, send: () => Promise<void>, now: Date) {
  const db = getDb()
  const key = `${input.notice.key}${input.suffix ?? ""}`
  let [row] = await db.insert(notificationDeliveries).values({ userId: input.userId, householdId: input.householdId, channel: input.channel, kind: input.notice.kind, dedupeKey: key, budgetKeys: input.notice.budgetKeys ?? [], createdAt: now })
    .onConflictDoNothing().returning()
  if (!row) {
    const [retry] = await db.update(notificationDeliveries).set({ status: "sending", attempts: sql`${notificationDeliveries.attempts} + 1`, error: null, nextAttemptAt: null, budgetKeys: input.notice.budgetKeys ?? [] })
      .where(and(eq(notificationDeliveries.userId, input.userId), eq(notificationDeliveries.channel, input.channel), eq(notificationDeliveries.dedupeKey, key),
        eq(notificationDeliveries.status, "retry"), lte(notificationDeliveries.nextAttemptAt, now))).returning()
    row = retry
  }
  if (!row) return false
  try {
    await send()
    await db.update(notificationDeliveries).set({ status: "sent", sentAt: now }).where(eq(notificationDeliveries.id, row.id))
  } catch (err) {
    const e = err instanceof DeliveryError ? err : new DeliveryError("delivery_unknown")
    const retry = e.retryable && row.attempts < 4
    await db.update(notificationDeliveries).set({ status: retry ? "retry" : e.code.endsWith("unknown") ? "unknown" : "failed", error: e.code,
      nextAttemptAt: retry ? new Date(now.getTime() + Math.max(60 * 2 ** row.attempts, e.retryAfter) * 1000) : null }).where(eq(notificationDeliveries.id, row.id))
  }
  return true
}
