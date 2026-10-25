import type { AiProvider } from "./types"

export const AI_PRESETS = [
  { id: "openai", label: "OpenAI", provider: "openai", baseUrl: "https://api.openai.com/v1" },
  { id: "anthropic", label: "Anthropic", provider: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
  { id: "google", label: "Google Gemini", provider: "google", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  { id: "openrouter", label: "OpenRouter", provider: "openai_compatible", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "ollama", label: "Ollama", provider: "openai_compatible", baseUrl: "http://localhost:11434/v1", selfHosted: true },
  { id: "lmstudio", label: "LM Studio", provider: "openai_compatible", baseUrl: "http://localhost:1234/v1", selfHosted: true },
  { id: "yandex", label: "YandexGPT (AI Studio)", provider: "openai_compatible", baseUrl: "https://ai.api.cloud.yandex.net/v1" },
  { id: "gigachat", label: "GigaChat", provider: "gigachat", baseUrl: "https://api.giga.chat/v1" },
  { id: "custom", label: "", provider: "openai_compatible", baseUrl: "" },
  { id: "mock", label: "Mock (test)", provider: "mock", baseUrl: "" },
] satisfies { id: string; label: string; provider: AiProvider; baseUrl: string; selfHosted?: boolean }[]

export function presetFor(provider: AiProvider, baseUrl: string) {
  return AI_PRESETS.find((p) => p.provider === provider && p.baseUrl === baseUrl.replace(/\/+$/, ""))?.id ??
    (provider === "openai_compatible" ? "custom" : provider)
}
