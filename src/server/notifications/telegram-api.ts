import "server-only"
import { setTimeout } from "node:timers/promises"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { applicationSettings } from "@/db/schema"

export class DeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
    readonly retryAfter = 0,
  ) {
    super(code)
    this.name = "DeliveryError"
  }
}

const rateState = z.object({ next: z.number(), chats: z.record(z.string(), z.number()) })
/** Reserve time slots under a row lock so all replicas share Telegram's rate limits. */
async function reserveSlot(chat: string | null) {
  return getDb().transaction(async (tx) => {
    const key = "notifications.telegram.rate"
    await tx
      .insert(applicationSettings)
      .values({ key, value: { next: 0, chats: {} } })
      .onConflictDoNothing()
    const [row] = await tx.select().from(applicationSettings).where(eq(applicationSettings.key, key)).for("update")
    const state = rateState.parse(row!.value)
    const now = Date.now()
    const at = Math.max(now, state.next, chat ? (state.chats[chat] ?? 0) : 0)
    if (at - now > 10_000) throw new DeliveryError("telegram_rate_limit", true, 10)
    const chats = Object.fromEntries(Object.entries(state.chats).filter(([, slot]) => slot > now))
    if (chat) chats[chat] = at + 1100
    await tx
      .update(applicationSettings)
      .set({ value: { next: at + 40, chats } })
      .where(eq(applicationSettings.key, key))
    return at
  })
}
export async function telegramApi<T>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  const at = await reserveSlot(method === "sendMessage" ? String(body.chat_id) : null)
  if (at > Date.now()) await setTimeout(at - Date.now(), undefined, { signal })
  signal?.throwIfAborted()
  let res: Response
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.any([
        AbortSignal.timeout(method === "getUpdates" ? 35_000 : 10_000),
        ...(signal ? [signal] : []),
      ]),
      redirect: "error",
    })
  } catch {
    signal?.throwIfAborted()
    throw new DeliveryError("telegram_unknown")
  }
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean
    result?: T
    error_code?: number
    parameters?: { retry_after?: number }
  } | null
  signal?.throwIfAborted()
  if (!data) throw new DeliveryError("telegram_unknown")
  if (!res.ok || !data.ok) {
    const status = data.error_code ?? res.status
    throw new DeliveryError(
      `telegram_${status}`,
      status === 429 || status >= 500,
      Math.min(86400, data.parameters?.retry_after ?? 0),
    )
  }
  return data.result as T
}
