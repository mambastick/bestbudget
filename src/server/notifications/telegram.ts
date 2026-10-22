import "server-only"
import { createHmac } from "node:crypto"
import { and, eq, gt } from "drizzle-orm"
import { getDb } from "@/db"
import { notificationSettings, telegramLinks, telegramUpdates, transactions, users } from "@/db/schema"
import { noticesFor, parsePaymentCallback, parseTelegramUpdate, preferencesInput, truncateMessage } from "@/domain/notifications"
import { hashToken, randomToken, safeEqual } from "@/lib/crypto"
import { addDays, todayIn } from "@/lib/dates"
import { env } from "@/lib/env"
import { formatMoney } from "@/lib/money"
import { audit } from "@/server/audit"
import { assertCan } from "@/server/context"
import { AppError } from "@/server/errors"
import { listMemberships, resolveHouseholdCtx } from "@/server/services/households"
import { disconnectTelegram } from "@/server/services/notifications"
import { telegramConfig } from "@/server/services/notification-settings"
import { actualBalance } from "@/server/services/reports"
import { confirmTransaction, getTransaction, listInRange } from "@/server/services/transactions"
import { DeliveryError, telegramApi } from "./telegram-api"

function signature(nonce: string) {
  return createHmac("sha256", env().BETTER_AUTH_SECRET).update(`telegram-link:${nonce}`).digest().subarray(0, 16).toString("base64url")
}
export function signLinkToken(nonce: string) { return `${nonce}.${signature(nonce)}` }
export function verifyLinkToken(token: string) {
  const [nonce, sig] = token.split(".")
  return /^[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{22}$/.test(token) && Boolean(nonce && sig && safeEqual(sig, signature(nonce)))
}
export async function createTelegramLink(userId: string) {
  const c = await telegramConfig()
  if (!c.token || !c.row.botUsername) throw new AppError("Бот ещё не готов. Администратор должен настроить его; затем дождитесь запуска фоновых задач.")
  const token = signLinkToken(randomToken(24))
  const expiresAt = new Date(Date.now() + 10 * 60_000)
  await getDb().insert(telegramLinks).values({ userId, tokenHash: hashToken(token), expiresAt })
    .onConflictDoUpdate({ target: telegramLinks.userId, set: { tokenHash: hashToken(token), expiresAt } })
  return { url: `https://t.me/${c.row.botUsername}?start=${token}`, expiresAt: expiresAt.toISOString() }
}
export async function bindTelegram(token: string, chatId: string) {
  if (!verifyLinkToken(token)) throw new AppError("Ссылка недействительна или истекла")
  return getDb().transaction(async (tx) => {
    const [link] = await tx.select().from(telegramLinks).where(and(eq(telegramLinks.tokenHash, hashToken(token)), gt(telegramLinks.expiresAt, new Date()))).for("update")
    if (!link) throw new AppError("Ссылка недействительна или истекла")
    const [user] = await tx.select().from(users).where(eq(users.id, link.userId))
    if (!user || user.banned) throw new AppError("Аккаунт недоступен")
    await tx.update(telegramLinks).set({ chatId, tokenHash: null, expiresAt: null }).where(eq(telegramLinks.userId, link.userId))
    await audit({ action: "notifications.telegram.connect", entityType: "telegram_link", actorId: link.userId }, tx)
    return link.userId
  })
}

/** The sender is resolved through the private chat binding, never through callback-provided user IDs. */
export async function confirmTelegramPayment(userId: string, data: string) {
  const payment = parsePaymentCallback(data)
  if (!payment) throw new AppError("Кнопка недействительна")
  const [user] = await getDb().select({ banned: users.banned }).from(users).where(eq(users.id, userId))
  if (!user || user.banned) throw new AppError("Аккаунт недоступен")
  const [row] = await getDb().select({ householdId: transactions.householdId }).from(transactions).where(eq(transactions.id, payment.id))
  const ctx = row ? await resolveHouseholdCtx(userId, row.householdId) : null
  if (!ctx) throw new AppError("Нет доступа к операции")
  const current = await getTransaction(ctx, payment.id)
  if (current.status !== "planned") throw new AppError("Операция уже подтверждена или пропущена")
  await confirmTransaction(ctx, payment.id, { version: payment.version })
}

export async function handleTelegramUpdate(raw: unknown, token: string, botId: string) {
  const u = parseTelegramUpdate(raw)
  if (!u) return
  const m = u.message
  const cb = u.callback_query
  const chat = m?.chat ?? cb?.message?.chat
  const sender = m?.from.id ?? cb?.from.id
  if (!chat || sender !== chat.id || m?.from.is_bot) return
  const db = getDb()
  const claimed = await db.insert(telegramUpdates).values({ key: `${botId}:${u.update_id}` }).onConflictDoNothing().returning()
  if (!claimed.length) return
  await db.update(notificationSettings).set({ lastUpdateAt: new Date(), transportError: null }).where(eq(notificationSettings.id, 1))
  const chatId = String(chat.id)
  const reply = (text: string) => telegramApi(token, "sendMessage", { chat_id: chatId, text: truncateMessage(text), link_preview_options: { is_disabled: true } })
  const [link] = await db.select({ userId: telegramLinks.userId }).from(telegramLinks).innerJoin(users, eq(users.id, telegramLinks.userId))
    .where(and(eq(telegramLinks.chatId, chatId), eq(users.banned, false)))
  if (cb) {
    let text = "Сначала подключите Telegram в профиле BestBudget"
    if (link && cb.data) {
      try { await confirmTelegramPayment(link.userId, cb.data); text = "✅ Платёж подтверждён" }
      catch (e) { text = e instanceof AppError ? e.message : "Не удалось подтвердить платёж. Откройте приложение." }
    }
    try { await telegramApi(token, "answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: true }) }
    catch (e) {
      // Minute-based polling can outlive Telegram's callback popup; still acknowledge the actual result.
      if (!(e instanceof DeliveryError) || e.code !== "telegram_400") throw e
      await reply(text)
    }
    return
  }
  const [command, arg] = (m?.text ?? "").trim().split(/\s+/)
  if (command === "/start" && arg) {
    try { await bindTelegram(arg, chatId); await reply("Telegram подключён. Включите канал в настройках уведомлений нужной семьи. Команды: /today, /balance, /stop.") }
    catch { await reply("Ссылка недействительна или истекла. Создайте новую в профиле BestBudget.") }
    return
  }
  if (!link) { await reply("Подключите Telegram в BestBudget: Настройки → Профиль и безопасность."); return }
  if (command === "/stop") { await disconnectTelegram(link.userId); await reply("Telegram отключён. Подключить заново можно в профиле BestBudget."); return }
  if (command !== "/today" && command !== "/balance") { await reply("Команды: /today — платежи сегодня и завтра; /balance — баланс; /stop — отключить."); return }
  // Replies are bounded; no financial data is persisted in the update journal.
  const sections: string[] = []
  for (const h of await listMemberships(link.userId)) {
    const ctx = await resolveHouseholdCtx(link.userId, h.id)
    if (!ctx) continue
    assertCan(ctx, "finance.read")
    if (command === "/balance") sections.push(`${h.name}: ${formatMoney(await actualBalance(ctx), ctx.currency)}`)
    else {
      const today = todayIn(ctx.timezone)
      const payments = await listInRange(ctx, today, addDays(today, 1))
      const notices = noticesFor({ householdId: h.id, currency: ctx.currency, payments, forecast: [], budgets: [] }, preferencesInput.parse({}), today)
      sections.push(`${h.name}\n${notices.map((n) => n.text).join("\n") || "Сегодня и завтра платежей нет."}`)
    }
  }
  await reply(sections.join("\n\n") || "Нет доступных семейных пространств.")
}

export async function pollTelegram(c: NonNullable<Awaited<ReturnType<typeof telegramConfig>>>) {
  if (!c.token || c.mode !== "polling" || !c.row.botId) return
  const updates = await telegramApi<{ update_id: number }[]>(c.token, "getUpdates", { offset: c.row.updateOffset, timeout: 20, limit: 30, allowed_updates: ["message", "callback_query"] })
  for (const update of updates) {
    await handleTelegramUpdate(update, c.token, c.row.botId)
    await getDb().update(notificationSettings).set({ updateOffset: update.update_id + 1 }).where(eq(notificationSettings.id, 1))
  }
}
