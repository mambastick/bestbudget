import "server-only"
import type { MockLanguageModelV3 } from "ai/test"
import { formatMoney } from "@/lib/money"
import { z } from "zod"

/** Synthetic interview script shared by streaming integration tests and the isolated e2e artifact. */
export function mockInterview(options: Parameters<MockLanguageModelV3["doStream"]>[0]) {
  const system = options.prompt
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n")
  if (!system.includes("kind=onboarding")) return null
  const english = system.includes("locale=en")
  const userIndex = options.prompt.findLastIndex((message) => message.role === "user")
  const turn = options.prompt.filter((message) => message.role === "user").length
  const current = options.prompt
    .slice(userIndex + 1)
    .filter((message) => message.role === "tool")
    .flatMap((message) => message.content)
  const all = options.prompt.filter((message) => message.role === "tool").flatMap((message) => message.content)
  const context = all.findLast((part) => part.type === "tool-result" && part.toolName === "get_interview_context")
  let call: { toolName: string; input: string } | undefined
  let text = ""
  const steps = ["income", "fixed", "variable", "goals", "preferences"]
  const questions = english
    ? [
        "Who earns income, how much, and on which dates?",
        "What housing and other bills do you pay? Are existing loans already tracked?",
        "How much would you allow for groceries, transport and entertainment?",
        "What would you like to save for? Would you like automatic top-ups?",
        "Would you prefer strict or flexible spending limits?",
      ]
    : [
        "Кто получает доход, сколько и в какие даты?",
        "Какие платежи за жильё и другие обязательства нужно учесть? Кредиты уже внесены?",
        "Какие лимиты подойдут для продуктов, транспорта и развлечений?",
        "На что хотите накопить? Нужно ли автопополнение?",
        "Предпочитаете строгие или гибкие лимиты?",
      ]
  const replies = english
    ? [
        ["My salary: 50,000 RUB on the 5th and 20th"],
        ["Rent: 30,000 RUB on the 1st; no loans"],
        ["Groceries 20,000; family fun 5,000 RUB monthly"],
        ["Emergency fund: 300,000 RUB, no automatic top-ups"],
        ["Flexible limits; prepare the plan"],
      ]
    : [
        ["Моя зарплата: по 50 000 ₽ 5-го и 20-го"],
        ["Аренда: 30 000 ₽ 1-го; кредитов нет"],
        ["Продукты 20 000; семейный досуг 5 000 ₽ в месяц"],
        ["Подушка: 300 000 ₽, без автопополнения"],
        ["Гибкие лимиты; составь план"],
      ]
  if (!context) call = { toolName: "get_interview_context", input: "{}" }
  else if (turn <= 5) {
    if (!current.some((part) => part.type === "tool-result" && part.toolName === "interview_step"))
      call = {
        toolName: "interview_step",
        input: JSON.stringify({ step: steps[turn - 1], questions: [questions[turn - 1]], quickReplies: replies[turn - 1] }),
      }
    else text = questions[turn - 1]!
  } else if (!current.some((part) => part.type === "tool-result" && part.toolName === "propose_budget_plan")) {
    const row = z.object({ id: z.string(), name: z.string(), kind: z.string() }).passthrough()
    const data = z
      .object({ list_accounts: z.array(row), list_categories: z.array(row) })
      .parse(context.type === "tool-result" && context.output.type === "json" ? context.output.value : {})
    const account = data.list_accounts.find((account) => account.kind !== "loan")!
    const income = data.list_categories.find((category) => category.kind === "income")!
    const expense = data.list_categories.find((category) => category.kind === "expense")!
    const fun =
      data.list_categories.find((category) => ["Семейный досуг", "Family fun"].includes(category.name))?.name ??
      (english ? "Family fun" : "Семейный досуг")
    const startDate = /Today=(\d{4}-\d{2}-\d{2})/.exec(system)![1]!
    const schedule = (type: "income" | "expense", amount: number, dayOfMonth: number, title: string, categoryName: string) => ({
      categoryName,
      rule: { type, amount, dayOfMonth, title, accountId: account.id, frequency: "monthly", startDate },
    })
    call = {
      toolName: "propose_budget_plan",
      input: JSON.stringify({
        title: english ? "Your family budget" : "Ваш семейный бюджет",
        categories: [{ name: fun, kind: "expense", icon: "smile", color: "#6366f1" }],
        recurring: [
          schedule("income", 5_000_000, 5, english ? "Salary" : "Зарплата", income.name),
          schedule("income", 5_000_000, 20, english ? "Advance" : "Аванс", income.name),
          schedule("expense", 3_000_000, 1, english ? "Rent" : "Аренда", expense.name),
          schedule("expense", 100_000, 28, english ? "Family evening" : "Семейный вечер", fun),
        ],
        budgets: [
          { categoryName: expense.name, amount: 5_000_000 },
          { categoryName: fun, amount: 500_000 },
        ],
        goals: [{ goal: { name: english ? "Emergency fund" : "Подушка", kind: "manual", currency: "RUB", targetAmount: 30_000_000 } }],
      }),
    }
  } else {
    const result = current.find((part) => part.type === "tool-result" && part.toolName === "propose_budget_plan")
    const parsed = z
      .object({
        status: z.string(),
        summary: z.object({
          income: z.number(),
          mandatory: z.number(),
          monthlyLimits: z.number(),
          remaining: z.number(),
          savings: z.number(),
          cashGaps: z.array(z.unknown()),
        }),
      })
      .safeParse(result?.type === "tool-result" && result.output.type === "json" ? result.output.value : {})
    if (!parsed.success) text = english ? "Please check the plan details and try again." : "Проверьте параметры плана и попробуйте ещё раз."
    else if (parsed.data.status === "unchanged")
      text = english ? "Your plan already matches. No changes are needed." : "Ваш план уже совпадает. Изменения не нужны."
    else {
      const summary = parsed.data.summary
      const money = (amount: number) => formatMoney(amount, "RUB", { locale: english ? "en" : "ru" })
      text = english
        ? `Monthly income ${money(summary.income)}, bills ${money(summary.mandatory)}, limits ${money(summary.monthlyLimits)}, savings ${money(summary.savings)}, remaining ${money(summary.remaining)}. ${summary.cashGaps.length ? "A cash gap is possible before income arrives. " : ""}The daily forecast covers scheduled payments. Review and apply selected items below.`
        : `Доход в месяц ${money(summary.income)}, обязательные платежи ${money(summary.mandatory)}, лимиты ${money(summary.monthlyLimits)}, накопления ${money(summary.savings)}, остаток ${money(summary.remaining)}. ${summary.cashGaps.length ? "Возможен кассовый разрыв до поступления дохода. " : ""}Ежедневный прогноз учитывает платежи с датами. Выберите и примените пункты ниже.`
    }
  }
  return { call, text }
}
