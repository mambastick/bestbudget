import { expect, it } from "vitest"
import { proposalChanges } from "./description"
import type { ProposalItem } from "./types"

it("builds before → after changes without internal metadata or unchanged fields", () => {
  const item: ProposalItem = {
    id: "item",
    type: "budget.set",
    permission: "catalog.manage",
    currency: "RUB",
    householdCurrency: "RUB",
    householdTimezone: "Europe/Moscow",
    label: "Food",
    input: {},
    operation: "update",
    before: { amount: 50000, categoryId: "same", version: 1 },
    after: { amount: 60000, categoryId: "same", version: 2 },
  }
  expect(proposalChanges(item)).toEqual([{ field: "amount", before: 50000, after: 60000 }])
})

it("shows creations without before values and hides unchanged financial/date context in edits", () => {
  expect(proposalChanges({ operation: "create", before: { references: {} }, after: { name: "Savings", openingBalance: 0 } })).toEqual([
    { field: "name", before: null, after: "Savings" },
    { field: "openingBalance", before: null, after: 0 },
  ])
  expect(
    proposalChanges({
      operation: "update",
      before: { amount: 1000, date: "2026-10-23", categoryId: "old" },
      after: { amount: 1000, date: "2026-10-23", categoryId: "new" },
    }),
  ).toEqual([{ field: "categoryId", before: "old", after: "new" }])
})

it("shows equal numeric amounts when their currency changed", () => {
  const item = {
    operation: "update" as const,
    currency: "RUB",
    beforeCurrency: "USD",
    before: { amount: 10000 },
    after: { amount: 10000 },
  }
  expect(proposalChanges(item)).toEqual([{ field: "amount", before: 10000, after: 10000 }])
})
