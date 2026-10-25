import "server-only"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import {
  generateText,
  APICallError,
  tool,
  wrapLanguageModel,
  simulateStreamingMiddleware,
  type LanguageModel,
  type ToolChoice,
} from "ai"
import { z } from "zod"
import { appUrl } from "@/lib/env"
import { aiProviderError, classifyAiError } from "./errors"
import { AppError } from "@/server/errors"
import { mockAllowed, type AiConfig } from "./config"
import { gigaFetch, gigaToken } from "./gigachat"

const safeFetch: typeof fetch = (url, init) =>
  fetch(url, { ...init, redirect: "error", signal: init?.signal ?? AbortSignal.timeout(20_000) })
function providerHeaders(config: AiConfig): Record<string, string> {
  return new URL(config.baseUrl).hostname === "openrouter.ai" ? { "HTTP-Referer": appUrl(), "X-Title": "BestBudget" } : {}
}
export async function languageModel(config: AiConfig): Promise<LanguageModel> {
  const options = { apiKey: config.apiKey || "", baseURL: config.baseUrl, fetch: safeFetch, headers: config.baseUrl ? providerHeaders(config) : {} }
  switch (config.provider) {
    case "openai":
      return createOpenAI(options).responses(config.model)
    case "openai_compatible":
      return createOpenAICompatible({ ...options, name: "compatible", includeUsage: true }).chatModel(config.model)
    case "anthropic":
      return createAnthropic(options)(config.model)
    case "google":
      return createGoogleGenerativeAI(options)(config.model)
    case "gigachat":
      return wrapLanguageModel({
        model: createOpenAICompatible({ ...options, name: "gigachat", fetch: gigaFetch(config, safeFetch) }).chatModel(config.model),
        middleware: simulateStreamingMiddleware(),
      })
    case "mock": {
      if (!mockAllowed()) throw new AppError("ai.mockDisabled")
      const { mockModel } = await import("./mock")
      return mockModel(config.model)
    }
  }
}
export async function probeConnection(config: AiConfig) {
  try {
    const model = await languageModel(config)
    const tools = {
      connection_check: tool({
        description: "Connection check",
        inputSchema: z.object({ value: z.literal("ok") }),
        execute: async () => ({ ok: true }),
      }),
    }
    const choices: ToolChoice<typeof tools>[] = [{ type: "tool", toolName: "connection_check" }, "required", "auto"]
    const abortSignal = AbortSignal.timeout(20_000)
    for (const [index, toolChoice] of choices.entries()) {
      try {
        const response = await generateText({
          model,
          prompt: "Call connection_check with value ok. You must call this tool to check the connection. Do not answer with text.",
          tools,
          toolChoice,
          maxOutputTokens: 128,
          maxRetries: 0,
          abortSignal,
        })
        if (!response.toolResults.some((t) => t.toolName === "connection_check")) throw new AppError("ai.noTools")
        return
      } catch (error) {
        if (classifyAiError(error).status === 400 && index < choices.length - 1) continue
        throw error
      }
    }
  } catch (error) {
    throw aiProviderError(error, [config.apiKey])
  }
}
const listSchema = z.object({
  data: z.array(z.object({ id: z.string() })).optional(),
  models: z.array(z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()).optional() })).optional(),
})
export async function listModels(config: AiConfig): Promise<string[]> {
  if (config.provider === "mock") {
    if (!mockAllowed()) throw new AppError("ai.mockDisabled")
    const { mockProviderFailure } = await import("./mock")
    try { mockProviderFailure(config.model) } catch (error) { throw aiProviderError(error, [config.apiKey]) }
    return ["test-budget", ...Array.from({ length: 500 }, (_, i) => `test-budget-${i}`)]
  }
  try {
    const headers: Record<string, string> = providerHeaders(config)
    if (config.provider === "anthropic") {
      headers["x-api-key"] = config.apiKey
      headers["anthropic-version"] = "2023-06-01"
    } else if (config.provider === "google") headers["x-goog-api-key"] = config.apiKey
    else if (config.apiKey || config.provider === "gigachat")
      headers.Authorization = `Bearer ${config.provider === "gigachat" ? await gigaToken(config) : config.apiKey}`
    let response = await safeFetch(`${config.baseUrl}/models`, { headers, signal: AbortSignal.timeout(10_000) })
    // Ollama's legacy tags endpoint is useful only when /models does not exist.
    if (response.status === 404 && config.provider === "openai_compatible" && new URL(config.baseUrl).hostname !== "openrouter.ai")
      response = await safeFetch(`${new URL(config.baseUrl).origin}/api/tags`, { headers, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new APICallError({
      message: "ModelListError", url: `${config.baseUrl}/models`, requestBodyValues: {},
      statusCode: response.status, responseBody: (await response.text()).slice(0, 16_384),
    })
    const data = listSchema.parse(await response.json())
    return [
      ...new Set(
        data.data?.map((m) => m.id) ??
          data.models
            ?.filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
            .map((m) => m.name.replace(/^models\//, "")) ??
          [],
      ),
    ].sort()
  } catch (error) {
    throw aiProviderError(error, [config.apiKey])
  }
}
