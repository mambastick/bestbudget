import { safeEqual } from "@/lib/crypto"
import { telegramConfig } from "@/server/services/notification-settings"
import { handleTelegramUpdate } from "@/server/notifications/telegram"

export const runtime = "nodejs"
export async function POST(request: Request) {
  const c = await telegramConfig()
  if (
    !c.token ||
    c.mode !== "webhook" ||
    !c.secret ||
    !c.row.botId ||
    !safeEqual(request.headers.get("x-telegram-bot-api-secret-token") ?? "", c.secret)
  )
    return new Response(null, { status: 403 })
  if (Number(request.headers.get("content-length") ?? 0) > 32_768) return new Response(null, { status: 413 })
  // Enforce a streaming limit too (Content-Length can be absent or forged).
  const reader = request.body?.getReader()
  if (!reader) return new Response(null, { status: 400 })
  let body = ""
  let size = 0
  const decoder = new TextDecoder()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.length
    if (size > 32_768) {
      await reader.cancel()
      return new Response(null, { status: 413 })
    }
    body += decoder.decode(value, { stream: true })
  }
  try {
    await handleTelegramUpdate(JSON.parse(body + decoder.decode()), c.token, c.row.botId)
  } catch {
    return new Response(null, { status: 503 })
  }
  return Response.json({ ok: true })
}
