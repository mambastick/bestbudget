import "server-only"
import { eq } from "drizzle-orm"
import webpush from "web-push"
import { z } from "zod"
import { getDb } from "@/db"
import { notificationSettings, telegramLinks } from "@/db/schema"
import { decryptSecret, encryptSecret, hashToken, randomToken } from "@/lib/crypto"
import { appUrl, env } from "@/lib/env"
import { audit } from "@/server/audit"
import { AppError, conflict } from "@/server/errors"
import { DeliveryError, telegramApi } from "@/server/notifications/telegram-api"

export async function settingsRow() {
  const db = getDb()
  await db.insert(notificationSettings).values({ id: 1 }).onConflictDoNothing()
  return (await db.select().from(notificationSettings).where(eq(notificationSettings.id, 1)))[0]!
}

export async function telegramConfig() {
  const row = await settingsRow()
  const e = env()
  return {
    token: e.TELEGRAM_BOT_TOKEN ?? (row.botTokenEncrypted ? decryptSecret(row.botTokenEncrypted) : null),
    mode: e.TELEGRAM_MODE ?? row.mode,
    secret:
      e.TELEGRAM_WEBHOOK_SECRET ?? (row.webhookSecretEncrypted ? decryptSecret(row.webhookSecretEncrypted) : null),
    row,
  }
}

export type TelegramConfig = Awaited<ReturnType<typeof telegramConfig>>

/** Delivery must wait for reconciliation after an ENV token or mode change. */
export function telegramTransportReady(config: TelegramConfig): boolean {
  if (!config.token || !config.secret || !config.row.botId) return false
  const fingerprint = hashToken(`${config.token}:${config.mode}:${appUrl()}:${config.secret}`)
  return config.row.transportFingerprint === fingerprint
}

export async function vapidConfig() {
  const e = env()
  const subject =
    e.VAPID_SUBJECT ?? (appUrl().startsWith("https://") ? new URL(appUrl()).origin : "mailto:admin@localhost")
  if (e.VAPID_PUBLIC_KEY || e.VAPID_PRIVATE_KEY) {
    if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) throw new AppError("Задайте оба VAPID-ключа")
    return { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject }
  }
  await settingsRow()
  // A row lock prevents two replicas generating different key pairs.
  return getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(notificationSettings).where(eq(notificationSettings.id, 1)).for("update")
    if (row!.vapidPublicKey && row!.vapidPrivateKeyEncrypted)
      return { publicKey: row!.vapidPublicKey, privateKey: decryptSecret(row!.vapidPrivateKeyEncrypted), subject }
    const keys = webpush.generateVAPIDKeys()
    await tx
      .update(notificationSettings)
      .set({ vapidPublicKey: keys.publicKey, vapidPrivateKeyEncrypted: encryptSecret(keys.privateKey) })
      .where(eq(notificationSettings.id, 1))
    return { ...keys, subject }
  })
}

export const telegramSettingsInput = z.object({
  token: z
    .string()
    .max(200)
    .regex(/^(\d+:[A-Za-z0-9_-]{20,}|)$/, "Некорректный токен бота")
    .default(""),
  mode: z.enum(["polling", "webhook"]),
  disabled: z.boolean().default(false),
  version: z.number().int().positive(),
})

export async function updateTelegramSettings(actorId: string, raw: z.input<typeof telegramSettingsInput>) {
  const input = telegramSettingsInput.parse(raw)
  if (env().TELEGRAM_BOT_TOKEN) throw new AppError("Бот настроен через переменные окружения")
  if (env().TELEGRAM_MODE && env().TELEGRAM_MODE !== input.mode) throw new AppError("Режим задан через TELEGRAM_MODE")
  if (!input.disabled && input.mode === "webhook" && !appUrl().startsWith("https://"))
    throw new AppError("Webhook требует публичный HTTPS APP_URL")
  const old = await telegramConfig()
  if (old.row.version !== input.version) throw conflict()
  const token = input.disabled ? null : input.token || old.token
  if (!input.disabled && !token) throw new AppError("Укажите токен бота")
  const bot = token ? await telegramApi<{ id: number; username: string }>(token, "getMe") : null
  // Remove the old webhook before a token is removed or replaced.
  if (old.token && old.token !== token) {
    try {
      await telegramApi(old.token, "deleteWebhook")
    } catch (e) {
      // Revoked tokens must not prevent replacement or disabling the bot.
      if (!(e instanceof DeliveryError) || !["telegram_401", "telegram_404"].includes(e.code)) throw e
    }
  }
  const secret = old.secret ?? randomToken()
  const values = {
    botTokenEncrypted: token ? encryptSecret(token) : null,
    botId: bot ? String(bot.id) : null,
    botUsername: bot?.username ?? null,
    mode: input.mode,
    webhookSecretEncrypted: encryptSecret(secret),
    transportFingerprint: null,
    transportError: null,
    ...(old.row.botId !== (bot ? String(bot.id) : null) ? { updateOffset: 0 } : {}),
    version: input.version + 1,
  }
  await getDb().transaction(async (tx) => {
    const changed = await tx
      .update(notificationSettings)
      .set(values)
      .where(eq(notificationSettings.version, input.version))
      .returning()
    if (!changed.length) throw conflict()
    if (old.row.botId !== values.botId) await tx.delete(telegramLinks)
    await audit(
      {
        action: "settings.notifications.update",
        entityType: "settings",
        actorId,
        meta: { mode: input.mode, enabled: Boolean(token) },
      },
      tx,
    )
  })
}

/** Reconcile only on configuration changes, without re-registering webhooks during long polling. */
export async function configureTelegramTransport(signal?: AbortSignal) {
  signal?.throwIfAborted()
  const c = await telegramConfig()
  if (!c.token) return null
  const secret = c.secret ?? randomToken()
  const fingerprint = hashToken(`${c.token}:${c.mode}:${appUrl()}:${secret}`)
  if (c.row.transportFingerprint !== fingerprint || !c.row.botId) {
    const bot = await telegramApi<{ id: number; username: string }>(c.token, "getMe", {}, signal)
    if (c.mode === "webhook") {
      if (!appUrl().startsWith("https://")) throw new AppError("Webhook требует HTTPS APP_URL")
      await telegramApi(
        c.token,
        "setWebhook",
        {
          url: `${appUrl()}/api/telegram/webhook`,
          secret_token: secret,
          allowed_updates: ["message", "callback_query"],
        },
        signal,
      )
    } else await telegramApi(c.token, "deleteWebhook", {}, signal)
    signal?.throwIfAborted()
    await getDb().transaction(async (tx) => {
      const [current] = await tx.select().from(notificationSettings).where(eq(notificationSettings.id, 1)).for("update")
      if (current?.version !== c.row.version) return
      if (c.row.botId && c.row.botId !== String(bot.id)) await tx.delete(telegramLinks)
      await tx
        .update(notificationSettings)
        .set({
          botId: String(bot.id),
          botUsername: bot.username,
          webhookSecretEncrypted: encryptSecret(secret),
          transportFingerprint: fingerprint,
          transportError: null,
          ...(c.row.botId !== String(bot.id) ? { updateOffset: 0 } : {}),
        })
        .where(eq(notificationSettings.id, 1))
    })
  }
  return telegramConfig()
}
