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
