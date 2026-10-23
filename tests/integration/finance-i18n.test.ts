import { describe, expect, it } from "vitest"
import { createAccount } from "@/server/services/catalog"
import { createRules, materializeRule } from "@/server/services/recurring"
import { createTransaction, exportTransactions, updateTransaction } from "@/server/services/transactions"
import { createConverter } from "@/server/services/exchange-rates"
import { todayIn } from "@/lib/dates"
import { setupHousehold } from "./helpers"

describe("generated transaction titles", () => {
  it("stores creator-localized transfer titles and never translates existing titles", async () => {
    const h = await setupHousehold()
    const target = await createAccount(h.ctx, { name: "Мой счёт", kind: "cash", openingBalance: 0 })
    const input = { type: "transfer" as const, amount: 100_00, accountId: h.mainAccount, toAccountId: target.id, date: todayIn(h.ctx.timezone), status: "posted" as const }
    const en = await createTransaction(h.ctx, input, undefined, "en")
    expect(en.title).toBe("Transfer")
    const ru = await createTransaction(h.ctx, input, undefined, "ru")
    expect(ru.title).toBe("Перевод")
    const edited = await updateTransaction(h.ctx, en.id, { ...input, title: "Мои данные", version: en.version }, undefined, "en")
    expect(edited.title).toBe("Мои данные")
    const [rule] = await createRules(h.ctx, { rule: { ...input, startDate: input.date, frequency: "daily" } }, undefined, "en")
    expect(rule!.title).toBe("Transfer")
    await materializeRule(rule!.id, input.date)
    const rows = await exportTransactions(h.ctx, {})
    expect(rows.filter((r) => r.recurringRuleId === rule!.id).every((r) => r.title === "Transfer")).toBe(true)
    expect(rows.find((r) => r.id === ru.id)!.title).toBe("Перевод")
  })
})


describe("localized FX warnings", () => {
  it("localizes missing rates without changing conversion or leaking request state", () => {
    const en = createConverter([], "RUB", "en")
    const ru = createConverter([], "RUB", "ru")
    expect(en.convert(100, "USD", "2026-10-20")).toBe(0)
    expect(ru.convert(100, "USD", "2026-10-20")).toBe(0)
    expect([...en.warnings]).toEqual(["No exchange rate for USD."])
    expect([...ru.warnings]).toEqual(["Нет курса USD."])
  })
})
