import "server-only"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import {
  generateText,
  ToolChoiceViolationError,
  UnsupportedFunctionalityError,
  tool,
  wrapLanguageModel,
  simulateStreamingMiddleware,
  type LanguageModel,
} from "ai"
import { z } from "zod"
import { AppError } from "@/server/errors"
import { mockAllowed, type AiConfig } from "./config"
import { gigaFetch, gigaToken } from "./gigachat"

const safeFetch: typeof fetch = (url, init) =>
  fetch(url, { ...init, redirect: "error", signal: init?.signal ?? AbortSignal.timeout(20_000) })
export async function languageModel(config: AiConfig): Promise<LanguageModel> {
  const options = { apiKey: config.apiKey || "", baseURL: config.baseUrl, fetch: safeFetch }
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
      return mockModel()
    }
  }
}
export async function probeConnection(config: AiConfig) {
  try {
    const response = await generateText({
      model: await languageModel(config),
      prompt: "Call connection_check with value ok. Do not answer with text.",
      tools: {
        connection_check: tool({
          description: "Connection check",
          inputSchema: z.object({ value: z.literal("ok") }),
          execute: async () => ({ ok: true }),
        }),
      },
      toolChoice: { type: "tool", toolName: "connection_check" },
      maxOutputTokens: 128,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(20_000),
    })
    if (!response.toolResults.some((t) => t.toolName === "connection_check")) throw new AppError("ai.noTools")
  } catch (error) {
    if (error instanceof AppError) throw error
    if (ToolChoiceViolationError.isInstance(error) || UnsupportedFunctionalityError.isInstance(error)) throw new AppError("ai.noTools")
    throw new AppError("ai.connectionFailed")
  }
}
const listSchema = z.object({
  data: z.array(z.object({ id: z.string() })).optional(),
  models: z.array(z.object({ name: z.string(), supportedGenerationMethods: z.array(z.string()).optional() })).optional(),
})
export async function listModels(config: AiConfig): Promise<string[]> {
  if (config.provider === "mock") {
    if (!mockAllowed()) throw new AppError("ai.mockDisabled")
    return ["test-budget"]
  }
  const headers: Record<string, string> = {}
  if (config.provider === "anthropic") {
    headers["x-api-key"] = config.apiKey
    headers["anthropic-version"] = "2023-06-01"
  } else if (config.provider === "google") headers["x-goog-api-key"] = config.apiKey
  else if (config.apiKey || config.provider === "gigachat")
    headers.Authorization = `Bearer ${config.provider === "gigachat" ? await gigaToken(config) : config.apiKey}`
  try {
    let response = await safeFetch(`${config.baseUrl}/models`, { headers, signal: AbortSignal.timeout(10_000) })
    if (!response.ok && config.provider === "openai_compatible")
      response = await safeFetch(`${new URL(config.baseUrl).origin}/api/tags`, { headers, signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error("ModelListError")
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
  } catch {
    throw new AppError("ai.modelsFailed")
  }
}
