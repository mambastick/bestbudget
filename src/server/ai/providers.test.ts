import { describe, expect, it, vi } from "vitest"
import { listModels, probeConnection } from "./providers"
import { resolveConfig } from "./config"

describe("provider capability checks", () => {
  const config = () =>
    resolveConfig(undefined, {
      AI_PROVIDER: "openai_compatible",
      AI_BASE_URL: "https://models.example.test/v1",
      AI_MODEL: "manual",
      AI_API_KEY: "synthetic-key",
    })!
  it("rejects a text-only response even when authentication and generation succeeded", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        id: "check",
        object: "chat.completion",
        model: "manual",
        created: 1,
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    )
    try {
      await expect(probeConnection(config())).rejects.toMatchObject({ messageKey: "ai.noTools" })
    } finally {
      request.mockRestore()
    }
  })
  it("lists provider models and falls back to Ollama tags without hardcoded model names", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }))
      .mockResolvedValueOnce(Response.json({ models: [{ name: "local-a:latest" }, { name: "local-b" }] }))
    try {
      expect(await listModels(config())).toEqual(["local-a:latest", "local-b"])
      expect(request.mock.calls[1]![0]).toBe("https://models.example.test/api/tags")
    } finally {
      request.mockRestore()
    }
  })
})

describe("compatible tool choice fallback and diagnostics", () => {
  const config = () => resolveConfig(undefined, {
    AI_PROVIDER: "openai_compatible", AI_BASE_URL: "https://openrouter.ai/api/v1", AI_MODEL: "manual", AI_API_KEY: "synthetic-key",
  })!
  const toolResponse = () => Response.json({
    id: "check", object: "chat.completion", model: "manual", created: 1,
    choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: [{ id: "check", type: "function", function: { name: "connection_check", arguments: '{"value":"ok"}' } }] }, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
  it.each([1, 2])("succeeds after %s rejected tool choices and sends OpenRouter headers", async (rejections) => {
    const choices: unknown[] = []
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      choices.push(JSON.parse(String(init?.body)).tool_choice)
      expect(new Headers(init?.headers).get("HTTP-Referer")).toBe("http://localhost:3000")
      expect(new Headers(init?.headers).get("X-Title")).toBe("BestBudget")
      return choices.length <= rejections ? Response.json({ error: { message: "tool_choice unsupported" } }, { status: 400 }) : toolResponse()
    })
    try {
      await probeConnection(config())
      expect(choices).toEqual([{ type: "function", function: { name: "connection_check" } }, "required", "auto"].slice(0, rejections + 1))
    } finally { request.mockRestore() }
  })
  it("still rejects an auto response without a tool call", async () => {
    const request = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ error: { message: "tool_choice" } }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ error: { message: "tool_choice" } }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ id: "check", model: "manual", created: 1, choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }))
    try { await expect(probeConnection(config())).rejects.toMatchObject({ messageKey: "ai.noTools" }) } finally { request.mockRestore() }
  })
  it.each([401, 402, 429, 500])("does not retry HTTP %s or hide it behind /api/tags", async (status) => {
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ error: { message: "synthetic-key rejected" } }, { status }))
    try {
      await expect(probeConnection(config())).rejects.toMatchObject({ diagnostic: { status, message: "[redacted] rejected" } })
      expect(request).toHaveBeenCalledTimes(1)
      request.mockClear()
      await expect(listModels(config())).rejects.toMatchObject({ diagnostic: { status } })
      expect(request).toHaveBeenCalledTimes(1)
    } finally { request.mockRestore() }
  })
})
