import type { ProposalItem } from "./types"

export const PROPOSAL_MONEY_FIELDS = new Set([
  "amount",
  "topupAmount",
  "targetAmount",
  "openingBalance",
  "creditLimit",
  "allocatedAmount",
  "toAmount",
  "minAmount",
  "maxAmount",
])
type CurrencyFields = Pick<
  ProposalItem,
  "currency" | "beforeCurrency" | "toCurrency" | "beforeToCurrency" | "fieldCurrencies" | "beforeFieldCurrencies"
>

export function proposalIsCreation(item: Pick<ProposalItem, "operation" | "before">) {
  return item.operation ? item.operation === "create" : !item.before?.id
}

/** Creation shows the complete entity; updates contain only effective changed fields. */
export function proposalChanges(item: Pick<ProposalItem, "operation" | "before" | "after"> & Partial<CurrencyFields>) {
  const create = proposalIsCreation(item)
  return Object.entries(item.after)
    .filter(([key, value]) => {
      if (["id", "version", "householdId"].includes(key) || value === undefined) return false
      if (create || JSON.stringify(item.before?.[key] ?? null) !== JSON.stringify(value ?? null)) return true
      if (typeof value !== "number" || !PROPOSAL_MONEY_FIELDS.has(key) || !item.currency) return false
      const currencies = { ...item, currency: item.currency }
      return proposalCurrency(currencies, key, true) !== proposalCurrency(currencies, key)
    })
    .map(([field, after]) => ({ field, before: item.before?.[field] ?? null, after }))
}

/** Preserve each field's unit, including account allocations and both sides of transfers. */
export function proposalCurrency(item: CurrencyFields, field: string, before = false) {
  const override = (before ? item.beforeFieldCurrencies : item.fieldCurrencies)?.[field]
  if (override) return override
  if (field === "toAmount") return (before ? item.beforeToCurrency : item.toCurrency) ?? item.currency
  return (before ? item.beforeCurrency : item.currency) ?? item.currency
}
