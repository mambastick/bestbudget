import { describe, expect, it } from "vitest"
import { proposalSummary } from "./summaries"
import { interviewConversationTitle } from "./conversation-title"
import type { ProposalItem } from "./types"

const base: ProposalItem = {
  id: "item",
  type: "goal.create",
  operation: "create",
  input: {},
  before: { references: {} },
  after: {},
  permission: "finance.write",
  label: "Подушка",
  currency: "RUB",
  householdCurrency: "RUB",
  householdTimezone: "Europe/Moscow",
}
const summary = (type: string, after: Record<string, unknown>, locale = "ru", extra: Partial<ProposalItem> = {}) =>
  proposalSummary({ ...base, type, after, ...extra }, { main: "Основной счёт", savings: "Накопительный" }, locale)!
const normalize = (text: string) => text.replace(/[\u00a0\u202f]/g, " ")

describe("creation summaries", () => {
  it("uses the category name and monthly amount for both kinds of new limit", () => {
    expect(normalize(summary("budget.planned", { categoryName: "Семейный досуг", amount: 500000 }).primary)).toBe(
      "Новая категория и лимит · Семейный досуг — 5 000 ₽ в месяц",
    )
    expect(summary("budget.set", { amount: 500000 }, "en", { label: "Family time" }).primary).toMatch(
      /^New limit · Family time — .* per month$/,
    )
  })
  it.each(["ru", "en"])("summarizes a manual goal without technical defaults (%s)", (locale) => {
    const result = summary(
      "goal.create",
      { name: "Подушка", kind: "manual", currency: "RUB", targetAmount: 30000000, priority: 100 },
      locale,
    )
    expect(normalize(result.primary)).toContain("300 000".replace(" ", locale === "en" ? "," : " "))
    expect(result.primary).toContain(locale === "ru" ? "ручная копилка" : "manual savings")
    expect(result.primary).not.toMatch(/RUB|currency|Валюта|priority|Приоритет/)
    expect(result.secondary).toBeUndefined()
  })
  it("preserves salary dates and account names, and the one-time date of rent", () => {
    const salary = summary("recurring.planned", {
      type: "income",
      title: "Зарплата",
      amount: 5000000,
      accountId: "main",
      frequency: "monthly",
      dayOfMonth: 5,
      startDate: "2026-11-05",
    })
    expect(normalize(salary.primary)).toBe("Новый регулярный доход · Зарплата — 50 000 ₽ 5-го числа на «Основной счёт»")
    expect(salary.secondary).toContain("2026")
    const rent = summary(
      "recurring.create",
      { type: "expense", title: "Rent", amount: 3000000, accountId: "main", frequency: "once", startDate: "2026-11-01" },
      "en",
    )
    expect(rent.primary).toMatch(/New recurring payment · Rent.*on .*November.*2026.*Основной счёт/)
    const ordinal = summary(
      "recurring.create",
      { type: "income", title: "Salary", amount: 5000000, accountId: "main", frequency: "monthly", dayOfMonth: 23 },
      "en",
    )
    expect(ordinal.primary).toContain("on the 23rd")
  })
  it("retains both sides of currency transfers without showing base currency codes", () => {
    const result = summary(
      "recurring.create",
      {
        type: "transfer",
        title: "Savings",
        amount: 100000,
        toAmount: 92000,
        accountId: "main",
        toAccountId: "savings",
        frequency: "monthly",
        dayOfMonth: 10,
      },
      "en",
      { currency: "USD", toCurrency: "EUR" },
    )
    expect(result.primary).toContain("(USD)")
    expect(result.secondary).toContain("(EUR)")
    expect(result.secondary).toContain("920")
    expect(result.secondary).toContain("Накопительный")
  })
  it("keeps an automated goal's target separate from its top-up amount, accounts and period", () => {
    const result = summary(
      "goal.create_automated",
      {
        name: "Подушка",
        kind: "account",
        accountId: "savings",
        targetAmount: 30000000,
        topupAmount: 2500000,
        toAmount: 2300000,
        sourceAccountId: "main",
        toAccountId: "savings",
        day: 10,
        startDate: "2026-11-10",
        endDate: "2027-10-10",
        targetDate: "2027-10-23",
      },
      "ru",
      { fieldCurrencies: { topupAmount: "USD" }, toCurrency: "EUR" },
    )
    expect(normalize(result.primary)).toContain("300 000 ₽")
    expect(normalize(result.secondary!)).toMatch(/25 000.*USD/)
    expect(result.secondary).toContain("(USD)")
    expect(result.secondary).toContain("(EUR)")
    expect(result.secondary).toContain("10-го числа")
    expect(result.secondary).toContain("2027")
    expect(result.secondary).toContain("Основной счёт")
  })
  it("resolves persisted reference names and never exposes missing account IDs", () => {
    const after = { type: "expense", title: "Аренда", amount: 3000000, accountId: "legacy-id", dayOfMonth: 1 }
    expect(
      summary("recurring.create", after, "ru", { before: { references: { accounts: [{ id: "legacy-id", name: "Старый счёт" }] } } })
        .primary,
    ).toContain("Старый счёт")
    const missing = summary("recurring.create", after).primary
    expect(missing).not.toContain("legacy-id")
    expect(missing).toContain("выбранный счёт")
  })
  it("summarizes the remaining creation types and leaves edits to before/after rendering", () => {
    expect(summary("category.create", { name: "Досуг" }).primary).toBe("Новая категория · Досуг")
    expect(summary("account.create", { name: "Основной", openingBalance: 10000, creditLimit: 50000 }).secondary).toContain("500")
    expect(summary("goal.automate", { amount: 100000, day: 5, accountId: "main", startDate: "2026-11-05" }).primary).toContain(
      "Основной счёт",
    )
    expect(
      summary(
        "import.rule",
        { categoryId: "private-id", descriptionPattern: "SHOP", descriptionMode: "contains", mcc: "5411", minAmount: 100 },
        "ru",
        { label: "Продукты" },
      ).primary,
    ).toContain("Продукты")
    expect(summary("import.rule", { categoryId: "id", descriptionPattern: "SHOP", currency: "USD" }, "en").secondary).toContain(
      "Only transactions in USD",
    )
    expect(summary("import.rule", { categoryId: "id", descriptionPattern: "SHOP", currency: "RUB" }, "en").secondary).not.toContain("RUB")
    expect(proposalSummary({ ...base, operation: "update", before: { amount: 100 }, after: { amount: 200 } }, {})).toBeNull()
  })
})

it("uses the household start date and user locale for the automatic interview title", () => {
  const start = new Date("2026-10-22T23:30:00Z")
  expect(interviewConversationTitle(start, "Europe/Moscow", "ru")).toBe("Составление бюджета · 23 окт.")
  expect(interviewConversationTitle(start, "Europe/Moscow", "en")).toBe("Budget setup · Oct 23")
  expect(interviewConversationTitle(start, "America/Los_Angeles", "en")).toBe("Budget setup · Oct 22")
})
