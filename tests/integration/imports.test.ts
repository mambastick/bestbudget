import { afterAll, describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { closeDb, getDb } from "@/db"
import { categoryRules, importRows, transactions } from "@/db/schema"
import { previewInputSchema, type RowDecision } from "@/domain/import/types"
import {
  previewImport,
  getImport,
  commitImport,
  undoImport,
  listImports,
  listImportProfiles,
  saveCategoryRule,
} from "@/server/services/imports"
import { createAccount, updateAccount } from "@/server/services/catalog"
import { createTransaction, deleteTransaction, exportTransactions, updateTransaction } from "@/server/services/transactions"
import { csvAmount, toCsv } from "@/domain/csv"
import { createLoan } from "@/server/services/loans"
import { createGoal, listGoals } from "@/server/services/goals"
import { addDays, todayIn } from "@/lib/dates"
import { setupHousehold } from "./helpers"

const header = "account;date;amount;currency;description;external_id;status;mcc"
const line = (amount = "-450.00", date = "2026-10-20", account = "DEMO_A", description = "MAGAZIN PRIMER") =>
  `${account};${date};${amount};RUB;${description};;posted;5411`
async function preview(h: Awaited<ReturnType<typeof setupHousehold>>, lines: string[], extra: Record<string, unknown> = {}) {
  const file = new TextEncoder().encode([header, ...lines].join("\r\n") + "\r\n")
  const result = await previewImport(
    h.ctx,
    file,
    previewInputSchema.parse({
      file: {},
      profile: "bestbudget-v1",
      mapping: { columns: {} },
      accounts: { DEMO_A: h.mainAccount },
      ...extra,
    }),
  )
  return getImport(h.ctx, result.id)
}
const commit = (
  h: Awaited<ReturnType<typeof setupHousehold>>,
  batch: Awaited<ReturnType<typeof getImport>>,
  decisions: RowDecision[] = [],
) => commitImport(h.ctx, { batchId: batch.batch.id, version: batch.batch.version, decisions })
const actual = (householdId: string) =>
  getDb()
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.status, "posted")))
afterAll(closeDb)

describe("statement import integration", () => {
  it("commits atomically, returns the committed result on retry and skips exact-file repeats", async () => {
    const h = await setupHousehold()
    const first = await preview(h, [line()])
    expect(first.rows[0]).toMatchObject({ decision: "create", categoryId: h.cat("Продукты") })
    expect(await commit(h, first)).toMatchObject({ created: 1 })
    expect(await commit(h, first)).toMatchObject({ created: 1 })
    const repeated = await preview(h, [line()])
    expect(repeated.batch.warnings.join(" ")).toMatch(/уже импортировали/)
    expect(repeated.rows[0]!.proposal.candidates[0]!.kind).toBe("duplicate")
    expect(repeated.rows[0]!.decision).toBe("skip")
    expect(await commit(h, repeated)).toMatchObject({ created: 0, skipped: 1 })
    expect(await actual(h.ctx.householdId)).toHaveLength(1)
  })
  it("preserves two identical purchases and consumes exactly the prior multiset in overlap", async () => {
    const h = await setupHousehold()
    await commit(h, await preview(h, [line()]))
    const overlap = await preview(h, [line(), line(), line("-500.00", "2026-10-21")])
    expect(overlap.rows.map((r) => r.decision)).toEqual(["skip", "create", "create"])
    expect(await commit(h, overlap)).toMatchObject({ created: 2, skipped: 1 })
    expect((await actual(h.ctx.householdId)).filter((r) => r.amount === 45000)).toHaveLength(2)
    const repeat = await preview(h, [line(), line()])
    expect(repeat.rows.map((r) => r.decision)).toEqual(["skip", "skip"])
    const fresh = await setupHousehold()
    expect(await commit(fresh, await preview(fresh, [line(), line()]))).toMatchObject({ created: 2 })
  })
  it("rejects a stale preview after an overlapping commit and concurrent retries stay idempotent", async () => {
    const h = await setupHousehold()
    const first = await preview(h, [line()]),
      stale = await preview(h, [line(), line("-100.00")])
    const retries = await Promise.all([commit(h, first), commit(h, first)])
    expect(retries.map((r) => r.created)).toEqual([1, 1])
    await expect(commit(h, stale)).rejects.toThrow(/ранее импортированные/)
    expect(await actual(h.ctx.householdId)).toHaveLength(1)
    expect((await getImport(h.ctx, stale.batch.id)).batch.status).toBe("draft")
  })
  it("uses stable external IDs across changed descriptions and rejects repeated IDs inside a file", async () => {
    const h = await setupHousehold()
    const withId = (description: string) =>
      line("-450.00", "2026-10-20", "DEMO_A", description).replace(";;posted", ";stable-demo-1;posted")
    const first = await preview(h, [withId("Shop")])
    await commit(h, first)
    const repeat = await preview(h, [withId("Changed shop")])
    expect(repeat.rows[0]!.decision).toBe("skip")
    expect(repeat.rows[0]!.proposal.candidates[0]!.kind).toBe("duplicate")
    await expect(commit(h, repeat, [{ rowId: repeat.rows[0]!.id, decision: "create", allowDuplicate: true }])).rejects.toThrow(
      /банковский ID уже импортирован/,
    )
    await undoImport(h.ctx, first.batch.id)
    const again = await preview(h, [withId("Shop"), withId("Shop")])
    expect(again.rows.map((r) => r.decision)).toEqual(["create", "skip"])
    expect(await commit(h, again)).toMatchObject({ created: 1, skipped: 1 })
  })
  it("allows an explicitly reviewed distinct purchase without a stable ID", async () => {
    const h = await setupHousehold()
    await commit(h, await preview(h, [line()]))
    const repeat = await preview(h, [line()])
    await commit(h, repeat, [{ rowId: repeat.rows[0]!.id, decision: "create", allowDuplicate: true }])
    expect(await actual(h.ctx.householdId)).toHaveLength(2)
  })
  it("defaults manual same-amount ±2 day matches to skip; can link them explicitly", async () => {
    const h = await setupHousehold()
    const manual = await createTransaction(h.ctx, {
      type: "expense",
      accountId: h.mainAccount,
      amount: 45000,
      categoryId: h.cat("Продукты"),
      date: "2026-10-19",
      status: "posted",
    })
    const batch = await preview(h, [line()])
    expect(batch.rows[0]!.decision).toBe("skip")
    await commit(h, batch, [{ rowId: batch.rows[0]!.id, decision: "link", candidateIndex: 0 }])
    expect((await getImport(h.ctx, batch.batch.id)).rows[0]!.transactionId).toBe(manual.id)
    expect(await actual(h.ctx.householdId)).toHaveLength(1)
  })
  it("turns two explicitly chosen own-account sides into one transfer and undoes both", async () => {
    const h = await setupHousehold()
    const savings = await createAccount(h.ctx, { name: "Savings", kind: "savings", openingBalance: 0 })
    const batch = await preview(h, [line("-2000.00"), line("2000.00", "2026-10-20", "DEMO_B")], {
      accounts: { DEMO_A: h.mainAccount, DEMO_B: savings.id },
    })
    const decisions = batch.rows.map((r) => ({
      rowId: r.id,
      decision: "transfer" as const,
      candidateIndex: r.proposal.candidates.findIndex((c) => c.kind === "transfer"),
    }))
    await commit(h, batch, decisions)
    expect(await actual(h.ctx.householdId)).toMatchObject([
      { type: "transfer", accountId: h.mainAccount, toAccountId: savings.id, amount: 200000 },
    ])
    const committed = await getImport(h.ctx, batch.batch.id)
    expect(new Set(committed.rows.map((r) => r.transactionId)).size).toBe(1)
    await undoImport(h.ctx, batch.batch.id)
    expect(await actual(h.ctx.householdId)).toHaveLength(0)
  })
  it("matches a later counterpart to the same transfer; refuses undo across committed batches", async () => {
    const h = await setupHousehold()
    const savings = await createAccount(h.ctx, { name: "Savings", kind: "savings", openingBalance: 0 })
    const first = await preview(h, [line("-2000.00")])
    await commit(h, first)
    const second = await preview(h, [line("2000.00", "2026-10-21", "DEMO_B")], { accounts: { DEMO_B: savings.id } })
    const row = second.rows[0]!
    await commit(h, second, [
      { rowId: row.id, decision: "transfer", candidateIndex: row.proposal.candidates.findIndex((c) => c.kind === "transfer") },
    ])
    expect(await actual(h.ctx.householdId)).toMatchObject([{ type: "transfer", accountId: h.mainAccount, toAccountId: savings.id }])
    await expect(undoImport(h.ctx, first.batch.id)).rejects.toThrow(/другой партией/)
    // The converted operation is owned by another import too: neither undo silently removes it.
    await expect(undoImport(h.ctx, second.batch.id)).rejects.toThrow(/другой партией/)
    const third = await preview(h, [line("2000.00", "2026-10-21", "DEMO_B")], { accounts: { DEMO_B: savings.id } })
    expect(third.rows[0]!.decision).toBe("skip")
  })
  it("converts an existing manual opposite side and undo restores it", async () => {
    const h = await setupHousehold()
    const savings = await createAccount(h.ctx, { name: "Savings", kind: "savings", openingBalance: 0 })
    const manual = await createTransaction(h.ctx, {
      type: "expense",
      accountId: h.mainAccount,
      amount: 200000,
      categoryId: h.cat("Прочее"),
      date: "2026-10-20",
      status: "posted",
    })
    const batch = await preview(h, [line("2000.00", "2026-10-21", "DEMO_B")], { accounts: { DEMO_B: savings.id } })
    const row = batch.rows[0]!
    await commit(h, batch, [
      { rowId: row.id, decision: "transfer", candidateIndex: row.proposal.candidates.findIndex((c) => c.kind === "transfer") },
    ])
    expect(await actual(h.ctx.householdId)).toMatchObject([{ id: manual.id, type: "transfer" }])
    await undoImport(h.ctx, batch.batch.id)
    expect(await actual(h.ctx.householdId)).toMatchObject([{ id: manual.id, type: "expense", categoryId: h.cat("Прочее") }])
  })
  it("confirms planned using actual amount/date and undo restores the original plan", async () => {
    const h = await setupHousehold()
    const plan = await createTransaction(h.ctx, {
      type: "expense",
      amount: 44900,
      accountId: h.mainAccount,
      categoryId: h.cat("Продукты"),
      date: "2026-10-19",
      status: "planned",
    })
    const batch = await preview(h, [line()], { plannedTolerance: 100, plannedDays: 2 })
    expect(batch.rows[0]!.decision).toBe("confirm")
    expect(await commit(h, batch)).toMatchObject({ created: 0, confirmed: 1 })
    expect(await actual(h.ctx.householdId)).toMatchObject([{ id: plan.id, amount: 45000, date: "2026-10-20" }])
    await undoImport(h.ctx, batch.batch.id)
    const restored = await getDb().select().from(transactions).where(eq(transactions.id, plan.id))
    expect(restored[0]).toMatchObject({ status: "planned", amount: 44900, date: "2026-10-19", version: 3 })
  })
  it("confirms both sides of a planned transfer once, using the debit date, and restores the plan", async () => {
    const h = await setupHousehold()
    const savings = await createAccount(h.ctx, { name: "Savings", kind: "savings", openingBalance: 0 })
    const plan = await createTransaction(h.ctx, {
      type: "transfer",
      amount: 200000,
      accountId: h.mainAccount,
      toAccountId: savings.id,
      date: "2026-10-19",
      status: "planned",
    })
    const batch = await preview(h, [line("2001.00", "2026-10-21", "DEMO_B"), line("-2001.00", "2026-10-20")], {
      accounts: { DEMO_A: h.mainAccount, DEMO_B: savings.id },
      plannedTolerance: 100,
    })
    expect(batch.rows.map((r) => r.decision)).toEqual(["confirm", "confirm"])
    expect(await commit(h, batch)).toMatchObject({ created: 0, confirmed: 1, linked: 1 })
    expect(await actual(h.ctx.householdId)).toMatchObject([{ id: plan.id, type: "transfer", amount: 200100, date: "2026-10-20" }])
    expect(new Set((await getImport(h.ctx, batch.batch.id)).rows.map((r) => r.transactionId)).size).toBe(1)
    await undoImport(h.ctx, batch.batch.id)
    expect((await getDb().select().from(transactions).where(eq(transactions.id, plan.id)))[0]).toMatchObject({
      status: "planned",
      amount: 200000,
      date: "2026-10-19",
    })
  })
  it("excludes composite loan payments and their parts, including a draft prepared before the loan existed", async () => {
    const h = await setupHousehold()
    const date = todayIn(h.ctx.timezone)
    const loan = await createLoan(h.ctx, {
      name: "Synthetic mortgage",
      lender: "Example",
      kind: "mortgage",
      principal: 10000000,
      trackingBalance: 10000000,
      annualRate: "12",
      trackingDate: addDays(date, -1),
      startDate: addDays(date, -1),
      firstPaymentDate: date,
      termMonths: 12,
      paymentDay: Number(date.slice(8)),
      scheduleType: "annuity",
      interestMethod: "monthly",
      paymentAccountId: h.mainAccount,
    })
    const parts = await getDb().select().from(transactions).where(eq(transactions.loanId, loan.id))
    const first = parts.filter((p) => p.loanDueDate === date)
    const amount = first.reduce((sum, p) => sum + p.amount, 0)
    const full = line(csvAmount(-amount).replace(",", "."), date)
    const batch = await preview(h, [full, line(csvAmount(-first[0]!.amount).replace(",", "."), date)])
    expect(batch.rows.every((r) => r.decision === "skip" && r.normalized.errors.some((e) => e.includes("платежом по кредиту")))).toBe(true)
    expect(await commit(h, batch)).toMatchObject({ created: 0, confirmed: 0, skipped: 2 })
    expect(await actual(h.ctx.householdId)).toHaveLength(0)
    // A pre-existing draft must also be refused after a loan schedule appears.
    const other = await setupHousehold()
    const stale = await preview(other, [full])
    await createLoan(other.ctx, { ...loan, name: "Later loan", interestCategoryId: undefined, paymentAccountId: other.mainAccount })
    await expect(commit(other, stale)).rejects.toThrow("платежом по кредиту")
    expect(await actual(other.ctx.householdId)).toHaveLength(0)
  })
  it("updates account-goal progress once for two statement sides and restores it on undo", async () => {
    const h = await setupHousehold()
    const savings = await createAccount(h.ctx, { name: "Goal savings", kind: "savings", openingBalance: 0 })
    const goal = await createGoal(h.ctx, {
      name: "Synthetic goal",
      kind: "account",
      accountId: savings.id,
      currency: "RUB",
      targetAmount: 1000000,
    })
    await createTransaction(h.ctx, {
      type: "transfer",
      amount: 200000,
      accountId: h.mainAccount,
      toAccountId: savings.id,
      date: "2026-10-20",
      status: "planned",
    })
    const batch = await preview(h, [line("-2000.00"), line("2000.00", "2026-10-20", "DEMO_B")], {
      accounts: { DEMO_A: h.mainAccount, DEMO_B: savings.id },
    })
    expect(batch.rows.every((r) => r.proposal.candidates.some((c) => c.kind === "planned" && c.transactionType === "transfer"))).toBe(true)
    expect(await commit(h, batch)).toMatchObject({ created: 0, confirmed: 1 })
    expect((await listGoals(h.ctx)).goals.find((g) => g.id === goal.id)?.progress).toBe(200000)
    await undoImport(h.ctx, batch.batch.id)
    expect((await listGoals(h.ctx)).goals.find((g) => g.id === goal.id)?.progress).toBe(0)
  })
  it("defaults a later imported side of an existing transfer to already-present without creating income", async () => {
    const h = await setupHousehold()
    const savings = await createAccount(h.ctx, { name: "Savings", kind: "savings", openingBalance: 0 })
    const plan = await createTransaction(h.ctx, {
      type: "transfer",
      amount: 200000,
      accountId: h.mainAccount,
      toAccountId: savings.id,
      date: "2026-10-20",
      status: "planned",
    })
    await commit(h, await preview(h, [line("-2000.00")]))
    const later = await preview(h, [line("2000.00", "2026-10-21", "DEMO_B")], { accounts: { DEMO_B: savings.id } })
    expect(later.rows[0]!.decision).toBe("skip")
    expect(later.rows[0]!.proposal.candidates.some((c) => c.kind === "manual" && c.transactionId === plan.id)).toBe(true)
    await commit(h, later)
    expect(await actual(h.ctx.householdId)).toMatchObject([{ id: plan.id, type: "transfer" }])
  })
  it("undo is all-or-nothing when one operation was changed; manual delete remains possible", async () => {
    const h = await setupHousehold()
    const batch = await preview(h, [line(), line("-100.00")])
    await commit(h, batch)
    const [changed] = await actual(h.ctx.householdId)
    await updateTransaction(h.ctx, changed!.id, { ...changed!, status: "posted", version: changed!.version, amount: 12345 })
    await expect(undoImport(h.ctx, batch.batch.id)).rejects.toThrow(/операция изменена/)
    expect(await actual(h.ctx.householdId)).toHaveLength(2)
    await deleteTransaction(h.ctx, changed!.id)
    expect(await actual(h.ctx.householdId)).toHaveLength(1)
    await expect(undoImport(h.ctx, batch.batch.id)).rejects.toThrow(/операция удалена/)
  })
  it("does not partially commit on missing category, bad decision or a pending row", async () => {
    const h = await setupHousehold()
    const batch = await preview(h, [line(), "DEMO_A;2026-10-21;50.00;RUB;Cashback;;posted;"])
    await expect(commit(h, batch)).rejects.toThrow(/категорию/)
    expect(await actual(h.ctx.householdId)).toHaveLength(0)
    const pending = await preview(h, [line().replace("posted", "pending")])
    await expect(commit(h, pending, [{ rowId: pending.rows[0]!.id, decision: "create", categoryId: h.cat("Продукты") }])).rejects.toThrow(
      /исправьте ошибки/,
    )
  })
  it("isolates household drafts, mappings, rules and composite foreign keys; member can import", async () => {
    const a = await setupHousehold(),
      b = await setupHousehold()
    const batch = await preview(a, [line()])
    await expect(getImport(b.ctx, batch.batch.id)).rejects.toThrow(/не найден/)
    await expect(commitImport(b.ctx, { batchId: batch.batch.id, version: 1, decisions: [] })).rejects.toThrow(/не найден/)
    await expect(undoImport(b.ctx, batch.batch.id)).rejects.toThrow(/не найден/)
    expect(await listImports(b.ctx)).toHaveLength(0)
    await expect(saveCategoryRule(a.ctx, { categoryId: b.cat("Продукты"), mcc: "5411" })).rejects.toThrow(/недоступна/)
    await expect(
      getDb().update(importRows).set({ accountId: b.mainAccount }).where(eq(importRows.batchId, batch.batch.id)),
    ).rejects.toThrow()
    await expect(
      getDb()
        .update(importRows)
        .set({ batchId: batch.batch.id, householdId: b.ctx.householdId })
        .where(eq(importRows.batchId, batch.batch.id)),
    ).rejects.toThrow()
    expect(await commitImport({ ...a.ctx, role: "member" }, { batchId: batch.batch.id, version: 1, decisions: [] })).toMatchObject({
      created: 1,
    })
    await expect(previewImport({ ...a.ctx, role: "viewer" as never }, new Uint8Array(), {} as never)).rejects.toThrow(/Недостаточно прав/)
  })
  it("saves household mapping and category rules from preview", async () => {
    const h = await setupHousehold()
    const batch = await preview(h, [line()], { saveProfileName: "My synthetic format" })
    await commit(h, batch, [{ rowId: batch.rows[0]!.id, decision: "create", categoryId: h.cat("Прочее"), remember: true }])
    expect(await listImportProfiles(h.ctx)).toHaveLength(1)
    const second = await preview(h, [line("-451.00", "2026-10-22")])
    expect(second.rows[0]!.categoryId).toBe(h.cat("Прочее"))
    expect(second.rows[0]!.proposal.categorySource).toMatch(/Правило v1/)
    expect(await getDb().select().from(categoryRules).where(eq(categoryRules.householdId, h.ctx.householdId))).toHaveLength(1)
  })
  it("round-trips BestBudget export with a cross-currency transfer and injection escaping", async () => {
    const source = await setupHousehold(),
      target = await setupHousehold()
    const usd = await createAccount(source.ctx, { name: "Dollar", kind: "savings", currency: "USD", openingBalance: 0 })
    const destUsd = await createAccount(target.ctx, { name: "Dollar", kind: "savings", currency: "USD", openingBalance: 0 })
    await createTransaction(source.ctx, {
      type: "expense",
      amount: 45000,
      categoryId: source.cat("Продукты"),
      accountId: source.mainAccount,
      date: "2026-10-20",
      status: "posted",
      title: "=TEST",
      description: "'@Shop",
    })
    await createTransaction(source.ctx, {
      type: "transfer",
      amount: 900000,
      toAmount: 10000,
      accountId: source.mainAccount,
      toAccountId: usd.id,
      date: "2026-10-21",
      status: "posted",
    })
    const exported = await exportTransactions(source.ctx, {})
    const file = toCsv([
      [
        "Дата",
        "Тип",
        "Статус",
        "Название",
        "Категория",
        "Счёт",
        "Счёт зачисления",
        "Сумма",
        "Валюта",
        "Зачислено",
        "Валюта зачисления",
        "Описание",
        "Автор",
        "ID операции",
      ],
      ...exported.map((r) => [
        r.date,
        r.type === "transfer" ? "Перевод" : "Расход",
        "Выполнена",
        r.title,
        r.categoryName,
        r.accountName,
        r.toAccountName,
        csvAmount(r.type === "expense" ? -r.amount : r.amount, r.currency),
        r.currency,
        r.type === "transfer" ? csvAmount(r.toAmount ?? r.amount, r.toCurrency!) : "",
        r.toCurrency,
        r.description,
        "Demo",
        r.id,
      ]),
    ])
    const result = await previewImport(
      target.ctx,
      new TextEncoder().encode(file),
      previewInputSchema.parse({
        file: {},
        profile: "bestbudget-export",
        mapping: { columns: {} },
        accounts: { "Основной счёт": target.mainAccount, Dollar: destUsd.id },
      }),
    )
    const previewed = await getImport(target.ctx, result.id)
    expect(previewed.rows.map((r) => r.normalized.errors)).toEqual([[], []])
    await commit(target, previewed)
    const imported = await actual(target.ctx.householdId)
    expect(imported.find((r) => r.type === "expense")).toMatchObject({ amount: 45000, title: "=TEST", description: "'@Shop" })
    expect(imported.find((r) => r.type === "transfer")).toMatchObject({ amount: 900000, toAmount: 10000, toAccountId: destUsd.id })
    const sameHousehold = await previewImport(
      source.ctx,
      new TextEncoder().encode(file),
      previewInputSchema.parse({
        file: {},
        profile: "bestbudget-export",
        mapping: { columns: {} },
        accounts: { "Основной счёт": source.mainAccount, Dollar: usd.id },
      }),
    )
    expect((await getImport(source.ctx, sameHousehold.id)).rows.map((r) => r.decision)).toEqual(["skip", "skip"])
  })
  it("preserves planned/skipped statuses from our export and later bank facts confirm the imported plan", async () => {
    const h = await setupHousehold()
    const file = toCsv([
      [
        "Дата",
        "Тип",
        "Статус",
        "Название",
        "Категория",
        "Счёт",
        "Счёт зачисления",
        "Сумма",
        "Валюта",
        "Зачислено",
        "Валюта зачисления",
        "Описание",
        "Автор",
      ],
      [
        "2026-10-20",
        "Расход",
        "Запланирована",
        "Plan",
        "Продукты",
        "Основной счёт",
        "",
        "-450,00",
        "RUB",
        "",
        "",
        "MAGAZIN PRIMER",
        "Demo",
      ],
      ["2026-10-21", "Расход", "Пропущена", "Skipped", "Продукты", "Основной счёт", "", "-100,00", "RUB", "", "", "Skipped shop", "Demo"],
    ])
    const input = previewInputSchema.parse({
      file: {},
      profile: "bestbudget-export",
      mapping: { columns: {} },
      accounts: { "Основной счёт": h.mainAccount },
    })
    const batch = await getImport(h.ctx, (await previewImport(h.ctx, new TextEncoder().encode(file), input)).id)
    expect(batch.rows.map((r) => r.decision)).toEqual(["create", "create"])
    await commit(h, batch)
    expect(await actual(h.ctx.householdId)).toHaveLength(0)
    const restored = await getDb()
      .select()
      .from(transactions)
      .where(eq(transactions.householdId, h.ctx.householdId))
      .orderBy(transactions.date)
    expect(restored.map((r) => r.status)).toEqual(["planned", "skipped"])
    const repeated = await getImport(h.ctx, (await previewImport(h.ctx, new TextEncoder().encode(file), input)).id)
    expect(repeated.rows.map((r) => r.decision)).toEqual(["skip", "skip"])
    const bank = await preview(h, [line()])
    expect(bank.rows[0]!.decision).toBe("confirm")
    await commit(h, bank)
    expect(await actual(h.ctx.householdId)).toMatchObject([{ id: restored[0]!.id, amount: 45000 }])
  })
  it("rejects a stale destination currency on an explicit exported transfer", async () => {
    const h = await setupHousehold()
    const destination = await createAccount(h.ctx, { name: "Dollar", kind: "savings", currency: "USD", openingBalance: 0 })
    const file = toCsv([
      [
        "Дата",
        "Тип",
        "Статус",
        "Название",
        "Категория",
        "Счёт",
        "Счёт зачисления",
        "Сумма",
        "Валюта",
        "Зачислено",
        "Валюта зачисления",
        "Описание",
        "Автор",
      ],
      [
        "2026-10-20",
        "Перевод",
        "Выполнена",
        "Transfer",
        "",
        "Основной счёт",
        "Dollar",
        "9000,00",
        "RUB",
        "100,00",
        "USD",
        "Demo transfer",
        "Demo",
      ],
    ])
    const result = await previewImport(
      h.ctx,
      new TextEncoder().encode(file),
      previewInputSchema.parse({
        file: {},
        profile: "bestbudget-export",
        mapping: { columns: {} },
        accounts: { "Основной счёт": h.mainAccount, Dollar: destination.id },
      }),
    )
    const batch = await getImport(h.ctx, result.id)
    await updateAccount(h.ctx, destination.id, {
      name: "Dollar",
      kind: "savings",
      currency: "EUR",
      openingBalance: 0,
      version: destination.version,
    })
    await expect(commit(h, batch)).rejects.toThrow(/валюта изменены/)
    expect(await actual(h.ctx.householdId)).toHaveLength(0)
  })
})
