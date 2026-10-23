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
    before: { amount: 50000, categoryId: "same", version: 1 },
    after: { amount: 60000, categoryId: "same", version: 2 },
  }
  expect(proposalChanges(item)).toEqual([{ field: "amount", before: 50000, after: 60000 }])
})
