import { describe, expect, it, vi } from "vitest"
import { gigaFetch, gigaToken } from "./gigachat"
import type { AiConfig } from "./config"

describe("GigaChat adapter", () => {
  it("exchanges credentials once, caches tokens, refreshes expired tokens and includes scope and request UUID", async () => {
    const config = {
      apiKey: "synthetic-basic-key",
      gigachatScope: "GIGACHAT_API_B2B",
      gigachatAuthUrl: "https://example.test/oauth",
    } as const
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ access_token: "access", expires_at: Date.now() + 120_000 }))
    await Promise.all([gigaToken(config, request), gigaToken(config, request)])
    expect(request).toHaveBeenCalledTimes(1)
    const init = request.mock.calls[0]![1]!
    expect(init.headers).toMatchObject({ Authorization: "Basic synthetic-basic-key", RqUID: expect.stringMatching(/^[0-9a-f-]{36}$/) })
    expect(String(init.body)).toBe("scope=GIGACHAT_API_B2B")
    vi.setSystemTime(Date.now() + 70_000)
    await gigaToken(config, request)
    expect(request).toHaveBeenCalledTimes(2)
  })
  it("maps native functions and object arguments to SDK-compatible tool calls", async () => {
    const config = { apiKey: "other-key", gigachatScope: "GIGACHAT_API_PERS", gigachatAuthUrl: "https://example.test/oauth" } as AiConfig
    const request = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      if (String(url).includes("oauth")) return Response.json({ access_token: "access", expires_at: Date.now() + 120000 })
      const body = JSON.parse(String(init!.body))
      expect(body.functions[0].name).toBe("read")
      expect(body.messages[0]).toEqual({ role: "function", content: "{}" })
      expect(body.stream).toBe(false)
      return Response.json({
        choices: [
          { message: { role: "assistant", function_call: { name: "read", arguments: { value: 1 } } }, finish_reason: "function_call" },
        ],
      })
    })
    const response = await gigaFetch(config, request)("https://example.test/chat/completions", {
      body: JSON.stringify({
        messages: [{ role: "tool", content: "{}" }],
        tools: [{ type: "function", function: { name: "read" } }],
        tool_choice: "auto",
      }),
    })
    expect((await response.json()).choices[0]).toMatchObject({
      finish_reason: "tool_calls",
      message: { tool_calls: [{ function: { name: "read", arguments: '{"value":1}' } }] },
    })
  })
})
