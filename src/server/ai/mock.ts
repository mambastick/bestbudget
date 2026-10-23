import "server-only"
import { MockLanguageModelV3 } from "ai/test"
import { simulateReadableStream, type LanguageModel } from "ai"
import { mockInterview } from "./mock-interview"
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
      if (options.tools?.some((t) => t.type === "function" && t.name === "submit_budget_review")) {
        const outputs = options.prompt
          .filter((m) => m.role === "tool")
          .flatMap((m) => m.content)
          .filter((o) => o.type === "tool-result")
        const data = outputs.find((o) => o.toolName === "get_review_period")?.output
        const value =
          data?.type === "json"
            ? (data.value as {
                period?: { from: string; to: string }
                overview?: { budgets?: { rows?: { id: string; name: string }[] } }
              })
            : null
        const cats = value?.overview?.budgets?.rows?.slice(0, 2) ?? []
        const proposed = outputs.filter((o) => o.toolName === "propose_budget_changes")
        const submitted = outputs.some((o) => o.toolName === "submit_budget_review")
        const english = options.prompt.some(
          (m) => m.role === "system" && typeof m.content === "string" && m.content.includes("locale=en"),
        )
        let call: { toolName: string; input: string } | undefined
        if (!data) call = { toolName: "get_review_period", input: "{}" }
        else if (
          options.tools?.some((t) => t.type === "function" && t.name === "search_transactions") &&
          !outputs.some((o) => o.toolName === "search_transactions")
        )
          call = {
            toolName: "search_transactions",
            input: JSON.stringify({ query: "", from: value!.period!.from, to: value!.period!.to }),
          }
        else if (proposed.length < cats.length) {
          const cat = cats[proposed.length]!
          call = {
            toolName: "propose_budget_changes",
            input: JSON.stringify({
              title: english ? `Monthly budget: ${cat.name}` : `Месячный лимит: ${cat.name}`,
              items: [{ type: "budget.set", input: { categoryId: cat.id, amount: (proposed.length + 1) * 100000 } }],
            }),
          }
        } else if (!submitted)
          call = {
            toolName: "submit_budget_review",
            input: JSON.stringify({
              insights: proposed.flatMap((p, i) => {
                const result = p.output.type === "json" ? (p.output.value as { status: string; proposalId: string }) : null
                return result?.status === "pending"
                  ? [
                      {
                        type: "budget",
                        entityId: cats[i]!.id,
                        direction: "increase",
                        title: english ? `Plan spending: ${cats[i]!.name}` : `План расходов: ${cats[i]!.name}`,
                        explanation: english
                          ? `Set a monthly limit of ${(i + 1) * 1000} RUB to plan this category. Review the amount before applying.`
                          : `Для планирования категории предлагается лимит ${(i + 1) * 1000} ₽ в месяц. Проверьте сумму перед применением.`,
                        importance: i ? "medium" : "high",
                        proposalIds: [result.proposalId],
                      },
                    ]
                  : []
              }),
            }),
          }
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              ...(call
                ? [{ type: "tool-call" as const, toolCallId: crypto.randomUUID(), ...call }]
                : [
                    { type: "text-start" as const, id: "review" },
                    {
                      type: "text-delta" as const,
                      id: "review",
                      delta: english ? "Budget review prepared." : "Разбор бюджета подготовлен.",
                    },
                    { type: "text-end" as const, id: "review" },
                  ]),
              {
                type: "finish" as const,
                finishReason: { unified: call ? ("tool-calls" as const) : ("stop" as const), raw: call ? "tool_calls" : "stop" },
                usage,
              },
            ],
          }),
        }
      }
      const latestUser = JSON.stringify(options.prompt.findLast((m) => m.role === "user"))
      if (/Попробуй ещё раз|Try again/.test(latestUser)) throw new Error("SyntheticProviderUnavailable")
      const slow = /Помоги настроить бюджеты, пожалуйста|Help me set up budgets, please/.test(latestUser)
      const outputs = options.prompt.filter((m) => m.role === "tool").flatMap((m) => m.content)
      const categoryResult = outputs.find((o) => o.type === "tool-result" && o.toolName === "list_categories")
      const english = options.prompt.some(
        (m) => m.role === "system" && typeof m.content === "string" && m.content.includes("locale=en"),
      )
      const userText = JSON.stringify(options.prompt.filter((m) => m.role === "user"))
      const wantsBudgets = /budget|бюджет/i.test(userText)
      const hasSearch = options.tools?.some((t) => t.type === "function" && t.name === "search_transactions")
      const proposed = outputs.find((o) => o.type === "tool-result" && o.toolName === "propose_budget_changes")
      const unchanged =
        proposed?.type === "tool-result" &&
        proposed.output.type === "json" &&
        proposed.output.value &&
        typeof proposed.output.value === "object" &&
        "status" in proposed.output.value &&
        proposed.output.value.status === "unchanged"
      const searchDone = outputs.some((o) => o.type === "tool-result" && o.toolName === "search_transactions")
      let call: { toolName: string; input: string } | undefined
      if (!wantsBudgets && hasSearch && !searchDone)
        call = { toolName: "search_transactions", input: JSON.stringify({ query: "", from: "2026-01-01", to: "2026-12-31" }) }
      else if (!wantsBudgets) call = undefined
      else if (!categoryResult) call = { toolName: "list_categories", input: "{}" }
      else if (!outputs.some((o) => o.type === "tool-result" && o.toolName === "propose_budget_changes")) {
        const result =
          categoryResult.type === "tool-result" && categoryResult.output.type === "json" ? categoryResult.output.value : []
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
      const interview = mockInterview(options)
      if (interview) call = interview.call
      return {
        stream: simulateReadableStream({
          initialDelayInMs: slow ? 1200 : 0,
          chunkDelayInMs: slow ? 350 : 0,
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            ...(call
              ? (() => {
                  const toolCallId = crypto.randomUUID()
                  return [
                    ...(slow
                      ? [
                          { type: "tool-input-start" as const, id: toolCallId, toolName: call.toolName },
                          { type: "tool-input-delta" as const, id: toolCallId, delta: call.input },
                          { type: "tool-input-end" as const, id: toolCallId },
                        ]
                      : []),
                    { type: "tool-call" as const, toolCallId, ...call },
                  ]
                })()
              : [
                  { type: "text-start" as const, id: "text" },
                  {
                    type: "text-delta" as const,
                    id: "text",
                    delta: interview ? interview.text : unchanged
                      ? english
                        ? "The current budgets already match. No changes are needed."
                        : "Текущие лимиты уже совпадают. Изменения не нужны."
                      : !wantsBudgets
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
