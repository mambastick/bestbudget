import { AppError } from "@/server/errors"
import { errorMessage } from "@/i18n/errors"
import { appUrl } from "@/lib/env"
import { actionHousehold } from "@/server/session"
import { chatResponse } from "@/server/ai/chat"
import { turnInput } from "@/server/ai/conversations"

export const dynamic = "force-dynamic"
export const maxDuration = 100
export async function POST(request: Request) {
  let locale = "ru"
  try {
    if (request.headers.get("origin") !== new URL(appUrl()).origin) return new Response("Forbidden", { status: 403 })
    if (Number(request.headers.get("content-length") || 0) > 20_000) return new Response("Too large", { status: 413 })
    const ctx = await actionHousehold()
    locale = ctx.locale ?? "ru"
    const reader = request.body?.getReader()
    if (!reader) return new Response("Bad request", { status: 400 })
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 20_000) {
        await reader.cancel()
        return new Response("Too large", { status: 413 })
      }
      chunks.push(value)
    }
    const text = Buffer.concat(chunks).toString("utf8")
    const parsed = turnInput.safeParse(JSON.parse(text))
    if (!parsed.success) return new Response("Bad request", { status: 400 })
    return await chatResponse(ctx, parsed.data, request.signal)
  } catch (error) {
    if (error instanceof AppError)
      return new Response(errorMessage(error.messageKey, error.params, locale), {
        status: error.code === "not_found" ? 404 : error.code === "unauthorized" ? 401 : error.code === "forbidden" ? 403 : 400,
        headers: { "Cache-Control": "no-store" },
      })
    return new Response(errorMessage("ai.providerError", {}, locale), { status: 500 })
  }
}
