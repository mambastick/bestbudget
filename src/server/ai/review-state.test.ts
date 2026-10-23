import { expect, it } from "vitest"
import type { ProposalItem } from "@/domain/ai/types"
import { reviewItemFingerprint } from "./review-state"

const recurring = (title: string, amount: number): ProposalItem => ({
  id: crypto.randomUUID(),
  type: "recurring.create",
  operation: "create",
  label: title,
  input: { title, accountId: "shared-account", categoryId: "subscriptions", amount },
  before: null,
  after: { title, amount },
  permission: "finance.write",
  currency: "RUB",
  householdCurrency: "RUB",
  householdTimezone: "Europe/Moscow",
})

it("keeps different new subscriptions independent even when they share an account and category", () => {
  expect(reviewItemFingerprint(recurring("Cinema", 100))).not.toBe(reviewItemFingerprint(recurring("Music", 100)))
  expect(reviewItemFingerprint(recurring("Cinema", 100))).toBe(reviewItemFingerprint(recurring(" cinema ", 999)))
})

it("preserves budget identity across wording but distinguishes opposite directions", () => {
  const item = {
    ...recurring("Budget", 200),
    type: "budget.set",
    operation: "update" as const,
    input: { categoryId: "food", amount: 200 },
    before: { amount: 100 },
    after: { amount: 200 },
  }
  expect(reviewItemFingerprint(item)).toBe(
    reviewItemFingerprint({
      ...item,
      label: "Reworded budget",
      input: { categoryId: "food", amount: 300 },
      after: { amount: 300 },
    }),
  )
  expect(reviewItemFingerprint(item)).not.toBe(
    reviewItemFingerprint({ ...item, input: { categoryId: "food", amount: 50 }, after: { amount: 50 } }),
  )
})
