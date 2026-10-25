import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { APICallError } from "ai"
import { z } from "zod"
import type { AiConfig } from "./config"

const tokens = new Map<string, { token: string; expires: number }>()
const pending = new Map<string, Promise<string>>()
export async function gigaToken(
  config: Pick<AiConfig, "apiKey" | "gigachatScope" | "gigachatAuthUrl">,
  request: typeof fetch = fetch,
): Promise<string> {
  const key = createHash("sha256")
    .update(JSON.stringify([config.apiKey, config.gigachatScope, config.gigachatAuthUrl]))
    .digest("hex")
  const cached = tokens.get(key)
  if (cached && cached.expires > Date.now() + 60_000) return cached.token
  const inflight = pending.get(key)
  if (inflight) return inflight
  const exchange = (async () => {
    const response = await request(config.gigachatAuthUrl, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Basic ${config.apiKey}`,
        RqUID: randomUUID(),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ scope: config.gigachatScope }),
    })
    if (!response.ok) throw new APICallError({ message: "GigaChatOAuthError", url: config.gigachatAuthUrl, requestBodyValues: {}, statusCode: response.status, responseBody: (await response.text()).slice(0, 16_384) })
    const result = z.object({ access_token: z.string().min(1), expires_at: z.number().positive() }).parse(await response.json())
    const expires = result.expires_at < 10_000_000_000 ? result.expires_at * 1000 : result.expires_at
    if (expires <= Date.now()) throw new Error("GigaChatExpiredToken")
    if (tokens.size > 20) tokens.clear()
    tokens.set(key, { token: result.access_token, expires })
    return result.access_token
  })()
  pending.set(key, exchange)
  try {
    return await exchange
  } finally {
    pending.delete(key)
  }
}

/** GigaChat v1 calls one function at a time; translate its wire format at the SDK boundary. */
export function gigaFetch(config: AiConfig, request: typeof fetch = fetch): typeof fetch {
  return async (url, init) => {
    const body = JSON.parse(String(init?.body))
    const functions = body.tools?.map((t: { function: unknown }) => t.function)
    const calls = new Map<string, string>()
    for (const message of body.messages) for (const call of message.tool_calls ?? []) calls.set(call.id, call.function.name)
    const messages = body.messages.flatMap(
      (m: {
        role: string
        content?: string
        tool_call_id?: string
        tool_calls?: { id: string; function: { name: string; arguments: string } }[]
      }) => {
        if (m.role === "tool")
          return [
            {
              role: "function",
              content: m.content,
              ...(m.tool_call_id && calls.has(m.tool_call_id) ? { name: calls.get(m.tool_call_id) } : {}),
            },
          ]
        if (m.tool_calls?.length)
          return m.tool_calls.map((t) => ({
            role: "assistant",
            content: m.content || "",
            ...(t.id.startsWith("giga:") ? { functions_state_id: Buffer.from(t.id.split(":")[1]!, "base64url").toString() } : {}),
            function_call: { name: t.function.name, arguments: JSON.parse(t.function.arguments) },
          }))
        return [m]
      },
    )
    const functionCall =
      body.tool_choice === "required"
        ? { name: functions?.[0]?.name }
        : body.tool_choice?.function
          ? { name: body.tool_choice.function.name }
          : "auto"
    const { tools: _tools, tool_choice: _choice, stream_options: _streamOptions, ...rest } = body
    void _tools
    void _choice
    void _streamOptions
    const response = await request(url, {
      ...init,
      redirect: "error",
      headers: { ...Object.fromEntries(new Headers(init?.headers)), Authorization: `Bearer ${await gigaToken(config, request)}` },
      body: JSON.stringify({ ...rest, messages, functions, function_call: functions?.length ? functionCall : "none", stream: false }),
    })
    if (!response.ok) return response
    const data = await response.json()
    for (const choice of data.choices ?? []) {
      if (choice.message.function_call) {
        const call = choice.message.function_call
        choice.message.tool_calls = [
          {
            id: choice.message.functions_state_id
              ? `giga:${Buffer.from(choice.message.functions_state_id).toString("base64url")}:${randomUUID()}`
              : call.id || randomUUID(),
            type: "function",
            function: { name: call.name, arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments) },
          },
        ]
        delete choice.message.function_call
        choice.finish_reason = "tool_calls"
      }
    }
    return Response.json(data)
  }
}
