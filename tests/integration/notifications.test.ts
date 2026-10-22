import { and, eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import webpush from "web-push"
import { closeDb, getDb } from "@/db"
import {
  householdMembers,
  notificationDeliveries,
  notificationSettings,
  pushSubscriptions,
  telegramLinks,
  telegramUpdates,
  users,
} from "@/db/schema"
import { preferencesInput } from "@/domain/notifications"
import { encryptSecret } from "@/lib/crypto"
import { POST as webhook } from "@/app/api/telegram/webhook/route"
import { runNotificationJob } from "@/server/jobs/notifications"
import { deliverOnce, sendPushNotice } from "@/server/notifications/delivery"
import {
  bindTelegram,
  confirmTelegramPayment,
  createTelegramLink,
  handleTelegramUpdate,
  pollTelegram,
  signLinkToken,
  verifyLinkToken,
} from "@/server/notifications/telegram"
import { DeliveryError, telegramApi } from "@/server/notifications/telegram-api"
import { allowedPushEndpoint, getPreferences, savePreferences, subscribePush } from "@/server/services/notifications"
import { setBudget } from "@/server/services/budgets"
import {
  configureTelegramTransport,
  telegramConfig,
  updateTelegramSettings,
  vapidConfig,
} from "@/server/services/notification-settings"
import { createTransaction, getTransaction } from "@/server/services/transactions"
import { createUser, setupHousehold } from "./helpers"

vi.mock("web-push", async (original) => {
  const mod = await original<{ default: typeof webpush }>()
  return { default: { ...mod.default, sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }) } }
})
const fetchMock = vi.fn(async (url: string, _options?: RequestInit) =>
  Response.json({
    ok: true,
    result: url.endsWith("getMe") ? { id: 987, username: "test_bot" } : url.endsWith("getUpdates") ? [] : true,
  }),
)
beforeEach(async () => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockClear()
  vi.mocked(webpush.sendNotification).mockClear()
  // Other service suites share this database; isolate notification transport state.
  await getDb().delete(notificationDeliveries)
  await getDb().delete(telegramUpdates)
  await getDb().delete(telegramLinks)
  await getDb().delete(pushSubscriptions)
  await getDb().delete(notificationSettings)
  await getDb()
    .insert(notificationSettings)
    .values({ id: 1, botTokenEncrypted: encryptSecret("123:test"), botUsername: "test_bot", botId: "987" })
  await configureTelegramTransport()
  fetchMock.mockClear()
})
afterAll(async () => {
  vi.unstubAllGlobals()
  await closeDb()
})

async function fixture() {
  const h = await setupHousehold()
  const row = await createTransaction(h.ctx, {
    type: "expense",
    title: "Ипотека",
    amount: 4500000,
    categoryId: h.cat("Ипотека"),
    accountId: h.mainAccount,
    status: "planned",
    date: "2026-10-24",
  })
  await getDb()
    .insert(telegramLinks)
    .values({ userId: h.owner.id, chatId: h.owner.id.replace(/\D/g, "").slice(0, 8) })
  await savePreferences(h.ctx, preferencesInput.parse({ telegram: true, cashGap: false, budget: false }))
  return { ...h, row }
}
const noon = new Date("2026-10-23T09:00:00Z")
describe("notification pipeline", () => {
  it("runs twice, sends once, and sends to two devices independently", async () => {
    const h = await fixture()
    const p = await getPreferences(h.ctx)
    await savePreferences(h.ctx, { ...p, push: true })
    for (const key of ["a", "b"])
      await subscribePush(
        h.owner.id,
        {
          endpoint: `https://fcm.googleapis.com/fcm/send/${key}`,
          keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
        },
        "test",
      )
    await runNotificationJob(noon)
    await runNotificationJob(noon)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("sendMessage"))).toHaveLength(1)
    expect(webpush.sendNotification).toHaveBeenCalledTimes(2)
    const deliveries = await getDb()
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.userId, h.owner.id))
    expect(deliveries).toHaveLength(3)
    expect(deliveries.every((d) => d.status === "sent")).toBe(true)
    expect(deliveries.map((d) => d.dedupeKey).every((k) => k.includes(h.row.id))).toBe(true)
  })
  it("deduplicates budget thresholds across digests, devices, mode changes and months", async () => {
    const h = await fixture()
    await getDb().update(telegramLinks).set({ chatId: "600" }).where(eq(telegramLinks.userId, h.owner.id))
    await createTransaction(h.ctx, {
      type: "expense",
      title: "Продукты",
      amount: 115000,
      categoryId: h.cat("Продукты"),
      accountId: h.mainAccount,
      status: "posted",
      date: "2026-10-23",
    })
    await setBudget(h.ctx, { categoryId: h.cat("Продукты"), amount: 100000 })
    await savePreferences(h.ctx, {
      ...(await getPreferences(h.ctx)),
      push: true,
      due: false,
      overdue: false,
      budget: true,
      digest: true,
    })
    for (const key of ["first", "second"])
      await subscribePush(
        h.owner.id,
        {
          endpoint: `https://fcm.googleapis.com/fcm/send/${key}`,
          keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
        },
        "test",
      )
    await runNotificationJob(noon)
    const sent = () =>
      fetchMock.mock.calls
        .filter(([url]) => url.endsWith("sendMessage"))
        .map(([, options]) => JSON.parse(String(options?.body)) as { text: string })
    expect(sent()[0]!.text).toContain("превышен на 15%")
    expect(
      vi
        .mocked(webpush.sendNotification)
        .mock.calls.map(([, body]) => String(body))
        .every((body) => body.includes("превышен на 15%")),
    ).toBe(true)
    await runNotificationJob(new Date("2026-10-24T09:00:00Z"))
    expect(sent()[1]!.text).not.toContain("превышен")
    await savePreferences(h.ctx, { ...(await getPreferences(h.ctx)), digest: false })
    await runNotificationJob(new Date("2026-10-25T09:00:00Z"))
    expect(sent()).toHaveLength(2)
    await createTransaction(h.ctx, {
      type: "expense",
      amount: 115000,
      categoryId: h.cat("Продукты"),
      accountId: h.mainAccount,
      status: "posted",
      date: "2026-11-01",
    })
    await runNotificationJob(new Date("2026-11-01T09:00:00Z"))
    expect(sent()[2]!.text).toContain("превышен на 15%")
  })

  it("claims concurrent sends once, and rate limits concurrent messages to the same chat", async () => {
    const h = await fixture()
    const send = vi.fn().mockResolvedValue(undefined)
    const input = {
      userId: h.owner.id,
      householdId: h.ctx.householdId,
      channel: "telegram",
      notice: { key: "concurrent", kind: "test", text: "test", path: "/" },
    }
    await Promise.all([deliverOnce(input, send, noon), deliverOnce(input, send, noon)])
    expect(send).toHaveBeenCalledOnce()
    const times: number[] = []
    fetchMock.mockImplementationOnce(async () => {
      times.push(Date.now())
      return Response.json({ ok: true, result: true })
    })
    fetchMock.mockImplementationOnce(async () => {
      times.push(Date.now())
      return Response.json({ ok: true, result: true })
    })
    await Promise.all([
      telegramApi("test", "sendMessage", { chat_id: "rate-chat", text: "a" }),
      telegramApi("test", "sendMessage", { chat_id: "rate-chat", text: "b" }),
    ])
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(1000)
  })

  it("authenticates and limits webhook bodies before processing updates", async () => {
    await getDb()
      .update(notificationSettings)
      .set({ mode: "webhook", webhookSecretEncrypted: encryptSecret("webhook-secret") })
      .where(eq(notificationSettings.id, 1))
    const request = (secret: string, body: string) =>
      new Request("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
        body,
      })
    expect((await webhook(request("wrong", "{}"))).status).toBe(403)
    expect((await webhook(request("webhook-secret", "x".repeat(32769)))).status).toBe(413)
    expect((await webhook(request("webhook-secret", JSON.stringify({ update_id: 50 })))).status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("can rotate a revoked bot token while keeping bindings for the same bot", async () => {
    const h = await fixture()
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, result: { id: 987, username: "test_bot" } }))
    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, error_code: 401 }, { status: 401 }))
    const current = await telegramConfig()
    const token = `555:${"A".repeat(30)}`
    await updateTelegramSettings(h.owner.id, { token, mode: "polling", version: current.row.version })
    expect((await telegramConfig()).token).toBe(token)
    expect(await getDb().select().from(telegramLinks).where(eq(telegramLinks.userId, h.owner.id))).toHaveLength(1)
  })

  it("retries a rejected standalone budget warning instead of suppressing it as already delivered", async () => {
    const h = await fixture()
    await savePreferences(h.ctx, { ...(await getPreferences(h.ctx)), due: false, overdue: false, budget: true })
    await setBudget(h.ctx, { categoryId: h.cat("Продукты"), amount: 100000 })
    await createTransaction(h.ctx, {
      type: "expense",
      amount: 115000,
      categoryId: h.cat("Продукты"),
      accountId: h.mainAccount,
      status: "posted",
      date: "2026-10-23",
    })
    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, error_code: 429 }, { status: 429 }))
    await runNotificationJob(noon)
    const rows = () =>
      getDb().select().from(notificationDeliveries).where(eq(notificationDeliveries.userId, h.owner.id))
    expect((await rows())[0]).toMatchObject({ status: "retry", kind: "budget", attempts: 1 })
    await runNotificationJob(new Date(noon.getTime() + 180000))
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 2 })
  })

  it("does not overwrite newer admin settings when reconciliation finishes with an obsolete configuration", async () => {
    const h = await fixture()
    const config = await telegramConfig()
    await getDb().update(notificationSettings).set({ transportFingerprint: null })
    fetchMock.mockImplementationOnce(async () => {
      await getDb()
        .update(notificationSettings)
        .set({
          mode: "webhook",
          version: config.row.version + 1,
          botId: "new-bot",
          transportFingerprint: "new-configuration",
        })
      return Response.json({ ok: true, result: { id: 9999, username: "obsolete_bot" } })
    })
    await configureTelegramTransport()
    const current = await telegramConfig()
    expect(current.row).toMatchObject({ mode: "webhook", botId: "new-bot", transportFingerprint: "new-configuration" })
    expect(await getDb().select().from(telegramLinks).where(eq(telegramLinks.userId, h.owner.id))).toHaveLength(1)
  })

  it("waits for transport reconciliation before sending with a replacement token", async () => {
    const h = await fixture()
    await getDb()
      .update(notificationSettings)
      .set({ botTokenEncrypted: encryptSecret("replacement-token") })
    await runNotificationJob(noon)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(
      await getDb().select().from(notificationDeliveries).where(eq(notificationDeliveries.userId, h.owner.id)),
    ).toHaveLength(0)
  })

  it("revoked members and banned users receive nothing; preferences cascade with membership", async () => {
    const h = await fixture()
    await getDb()
      .delete(householdMembers)
      .where(and(eq(householdMembers.householdId, h.ctx.householdId), eq(householdMembers.userId, h.owner.id)))
    await runNotificationJob(noon)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("sendMessage"))).toHaveLength(0)
    const b = await fixture()
    await getDb().update(users).set({ banned: true }).where(eq(users.id, b.owner.id))
    await runNotificationJob(noon)
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("sendMessage"))).toHaveLength(0)
  })
  it("retries explicit transient errors with bounded backoff and never retries ambiguous outcomes", async () => {
    const h = await fixture()
    const input = {
      userId: h.owner.id,
      householdId: h.ctx.householdId,
      channel: "telegram",
      notice: { key: "retry", kind: "test", text: "test", path: "/" },
    }
    const send = vi.fn().mockRejectedValue(new DeliveryError("telegram_429", true, 300))
    await deliverOnce(input, send, noon)
    await deliverOnce(input, send, new Date(noon.getTime() + 299000))
    expect(send).toHaveBeenCalledTimes(1)
    for (const minutes of [5, 15, 40, 100]) await deliverOnce(input, send, new Date(noon.getTime() + minutes * 60000))
    expect(send).toHaveBeenCalledTimes(4)
    const unknown = vi.fn().mockRejectedValue(new Error("sensitive secret"))
    await deliverOnce({ ...input, notice: { ...input.notice, key: "unknown" } }, unknown, noon)
    await deliverOnce({ ...input, notice: { ...input.notice, key: "unknown" } }, unknown, noon)
    expect(unknown).toHaveBeenCalledTimes(1)
    const [row] = await getDb()
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.dedupeKey, "unknown"))
    expect(row).toMatchObject({ status: "unknown", error: "delivery_unknown" })
  })
  it("removes expired push endpoints on 410, and refuses arbitrary endpoint URLs", async () => {
    const h = await fixture()
    await subscribePush(
      h.owner.id,
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/expired",
        keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
      },
      "test",
    )
    const [device] = await getDb().select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, h.owner.id))
    expect(device!.auth).not.toBe("A".repeat(22))
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 410 })
    await expect(
      sendPushNotice(device!, { key: "expired", kind: "test", text: "test", path: "/" }),
    ).rejects.toMatchObject({ code: "push_410" })
    expect(vi.mocked(webpush.sendNotification).mock.calls[0]![0].keys.auth).toBe("A".repeat(22))
    expect(await getDb().select().from(pushSubscriptions).where(eq(pushSubscriptions.id, device!.id))).toHaveLength(0)
    for (const url of [
      "http://127.0.0.1",
      "https://fcm.googleapis.com.attacker.test/x",
      "https://user@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:123/x",
    ])
      expect(allowedPushEndpoint(url)).toBe(false)
    expect((await vapidConfig()).publicKey).toBe((await vapidConfig()).publicKey)
  })
  it("confirms only owned planned operations with current versions, through a private callback", async () => {
    const h = await fixture()
    const other = await setupHousehold()
    await expect(confirmTelegramPayment(other.owner.id, `pay:${h.row.id}:1`)).rejects.toThrow(/Нет доступа/)
    await expect(confirmTelegramPayment(h.owner.id, `pay:${h.row.id}:2`)).rejects.toThrow(/изменены/)
    await getDb().update(telegramLinks).set({ chatId: "123" }).where(eq(telegramLinks.userId, h.owner.id))
    const update = {
      update_id: 77,
      callback_query: {
        id: "callback",
        from: { id: 123 },
        data: `pay:${h.row.id}:1`,
        message: { chat: { id: 123, type: "private" } },
      },
    }
    await handleTelegramUpdate(update, "test-token", "987")
    await handleTelegramUpdate(update, "test-token", "987")
    expect(await getTransaction(h.ctx, h.row.id)).toMatchObject({ status: "posted", version: 2 })
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("answerCallbackQuery"))).toHaveLength(2)
    await expect(confirmTelegramPayment(h.owner.id, `pay:${h.row.id}:1`)).rejects.toThrow(/уже/)
    await expect(confirmTelegramPayment((await createUser()).id, `pay:${h.row.id}:1`)).rejects.toThrow()
  })
  it("acknowledges callbacks before reading or confirming the payment", async () => {
    const h = await fixture()
    await getDb().update(telegramLinks).set({ chatId: "800" }).where(eq(telegramLinks.userId, h.owner.id))
    fetchMock.mockImplementationOnce(async (url) => {
      expect(url).toMatch(/answerCallbackQuery$/)
      expect(await getTransaction(h.ctx, h.row.id)).toMatchObject({ status: "planned", version: 1 })
      expect(await getDb().select().from(telegramUpdates)).toHaveLength(0)
      return Response.json({ ok: true, result: true })
    })
    await handleTelegramUpdate(
      {
        update_id: 89,
        callback_query: {
          id: "immediate",
          from: { id: 800 },
          data: `pay:${h.row.id}:1`,
          message: { chat: { id: 800, type: "private" } },
        },
      },
      "test-token",
      "987",
    )
    expect(await getTransaction(h.ctx, h.row.id)).toMatchObject({ status: "posted", version: 2 })
    expect(fetchMock.mock.calls[1]![0]).toMatch(/sendMessage$/)
  })

  it("cancels a long poll and ignores responses from a replaced configuration", async () => {
    const config = await telegramConfig()
    const stopped = new AbortController()
    fetchMock.mockImplementationOnce(async (_url, options) => {
      const body = JSON.parse(String(options?.body)) as { timeout: number }
      expect(body.timeout).toBe(30)
      const signal = options?.signal
      expect(signal).toBeDefined()
      stopped.abort()
      signal!.throwIfAborted()
      return Response.json({ ok: true, result: [] })
    })
    await expect(pollTelegram(config, stopped.signal)).rejects.toMatchObject({ name: "AbortError" })

    await getDb()
      .update(notificationSettings)
      .set({ mode: "webhook", version: config.row.version + 1 })
    fetchMock.mockResolvedValueOnce(
      Response.json({
        ok: true,
        result: [
          {
            update_id: 90,
            message: { text: "/today", from: { id: 800 }, chat: { id: 800, type: "private" } },
          },
        ],
      }),
    )
    await pollTelegram(config)
    expect(await getDb().select().from(telegramUpdates)).toHaveLength(0)
    expect((await telegramConfig()).row.updateOffset).toBe(0)
  })

  it("does not regress the offset when a stale response arrives after another consumer advanced it", async () => {
    const config = await telegramConfig()
    await getDb().update(notificationSettings).set({ updateOffset: 500 })
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true, result: [{ update_id: 90 }] }))
    await pollTelegram(config)
    expect((await telegramConfig()).row.updateOffset).toBe(500)
  })

  it("acknowledges a confirmed payment even when Telegram's callback popup has expired", async () => {
    const h = await fixture()
    await getDb().update(telegramLinks).set({ chatId: "700" }).where(eq(telegramLinks.userId, h.owner.id))
    fetchMock.mockResolvedValueOnce(Response.json({ ok: false, error_code: 400 }, { status: 400 }))
    await handleTelegramUpdate(
      {
        update_id: 88,
        callback_query: {
          id: "expired",
          from: { id: 700 },
          data: `pay:${h.row.id}:1`,
          message: { chat: { id: 700, type: "private" } },
        },
      },
      "test-token",
      "987",
    )
    expect(await getTransaction(h.ctx, h.row.id)).toMatchObject({ status: "posted", version: 2 })
    const sent = fetchMock.mock.calls.find(([url]) => url.endsWith("sendMessage"))
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({ chat_id: "700", text: "✅ Платёж подтверждён" })
  })

  it("signs, expires and atomically consumes link tokens without exposing stored tokens", async () => {
    const user = await createUser()
    const token = signLinkToken("A".repeat(32))
    expect(token.length).toBeLessThanOrEqual(64)
    expect(verifyLinkToken(token)).toBe(true)
    expect(verifyLinkToken(token.slice(0, -1) + "!")).toBe(false)
    const link = await createTelegramLink(user.id)
    const raw = new URL(link.url).searchParams.get("start")!
    const [stored] = await getDb().select().from(telegramLinks).where(eq(telegramLinks.userId, user.id))
    expect(stored!.tokenHash).not.toContain(raw)
    expect(await bindTelegram(raw, "456")).toBe(user.id)
    await expect(bindTelegram(raw, "789")).rejects.toThrow(/истекла/)
    const next = new URL((await createTelegramLink(user.id)).url).searchParams.get("start")!
    await getDb()
      .update(telegramLinks)
      .set({ expiresAt: new Date(0) })
      .where(eq(telegramLinks.userId, user.id))
    await expect(bindTelegram(next, "789")).rejects.toThrow(/истекла/)
  })
})
