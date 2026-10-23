import "server-only"
import { MockLanguageModelV3 } from "ai/test"
import { simulateReadableStream, type LanguageModel } from "ai"
import { mockAllowed } from "./config"

/** Deterministic SDK model for isolated tests. Never contacts a provider. */
export function mockModel(): LanguageModel {
  if (!mockAllowed()) throw new Error("MockDisabled")
  const usage = {
    inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 50, text: 50, reasoning: 0 },
  }
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "tool-call", toolCallId: "probe", toolName: "connection_check", input: '{"value":"ok"}' }],
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage,
      warnings: [],
    }),
    doStream: async (options) => {
      const outputs = options.prompt.filter((m) => m.role === "tool").flatMap((m) => m.content)
      const categoryResult = outputs.find((o) => o.type === "tool-result" && o.toolName === "list_categories")
      const english = options.prompt.some((m) => m.role === "system" && typeof m.content === "string" && m.content.includes("locale=en"))
      const userText = JSON.stringify(options.prompt.filter((m) => m.role === "user"))
      const wantsBudgets = /budget|бюджет/i.test(userText)
      const hasSearch = options.tools?.some((t) => t.type === "function" && t.name === "search_transactions")
      const searchDone = outputs.some((o) => o.type === "tool-result" && o.toolName === "search_transactions")
      let call: { toolName: string; input: string } | undefined
      if (!wantsBudgets && hasSearch && !searchDone)
        call = { toolName: "search_transactions", input: JSON.stringify({ query: "", from: "2026-01-01", to: "2026-12-31" }) }
      else if (!wantsBudgets) call = undefined
      else if (!categoryResult) call = { toolName: "list_categories", input: "{}" }
      else if (!outputs.some((o) => o.type === "tool-result" && o.toolName === "propose_budget_changes")) {
        const result = categoryResult.type === "tool-result" && categoryResult.output.type === "json" ? categoryResult.output.value : []
        const cats = (Array.isArray(result) ? result : [])
          .filter((c) => c && typeof c === "object" && "kind" in c && c.kind === "expense")
          .slice(0, 3)
        call = {
          toolName: "propose_budget_changes",
          input: JSON.stringify({
            title: english ? "Monthly budgets" : "Месячные лимиты",
            items: cats.map((cat, i) => ({
              type: "budget.set",
              input: { categoryId: cat && typeof cat === "object" && "id" in cat ? cat.id : "", amount: (i + 1) * 100000 },
            })),
          }),
        }
      }
      return {
        stream: simulateReadableStream({
          initialDelayInMs: 0,
          chunkDelayInMs: 0,
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            ...(call
              ? [{ type: "tool-call" as const, toolCallId: crypto.randomUUID(), ...call }]
              : [
                  { type: "text-start" as const, id: "text" },
                  {
                    type: "text-delta" as const,
                    id: "text",
                    delta: !wantsBudgets
                      ? english
                        ? "I reviewed the transaction data. You can ask about spending by category or period."
                        : "Я посмотрел операции. Можно уточнить расходы по категории или периоду."
                      : english
                        ? "Review the proposed monthly budgets below. Apply only the changes you choose."
                        : "Предлагаю месячные лимиты. Выберите нужные пункты в карточке и примените их.",
                  },
                  { type: "text-end" as const, id: "text" },
                ]),
            {
              type: "finish" as const,
              finishReason: { unified: call ? ("tool-calls" as const) : ("stop" as const), raw: call ? "tool_calls" : "stop" },
              usage,
            },
          ],
        }),
      }
    },
  })
}
