import type { ProposalItem } from "./types"

export function proposalIsCreation(item: Pick<ProposalItem, "operation" | "before">) {
  return item.operation ? item.operation === "create" : !item.before?.id
}

/** Creation shows the complete entity; updates contain only effective changed fields. */
export function proposalChanges(item: Pick<ProposalItem, "operation" | "before" | "after">) {
  const create = proposalIsCreation(item)
  return Object.entries(item.after)
    .filter(
      ([key, value]) =>
        !["id", "version", "householdId"].includes(key) &&
        value !== undefined &&
        (create || JSON.stringify(item.before?.[key] ?? null) !== JSON.stringify(value ?? null)),
    )
    .map(([field, after]) => ({ field, before: item.before?.[field] ?? null, after }))
}

/** Preserve each field's unit, including account allocations and both sides of transfers. */
export function proposalCurrency(item: ProposalItem, field: string, before = false) {
  const override = (before ? item.beforeFieldCurrencies : item.fieldCurrencies)?.[field]
  if (override) return override
  if (field === "toAmount") return (before ? item.beforeToCurrency : item.toCurrency) ?? item.currency
  return (before ? item.beforeCurrency : item.currency) ?? item.currency
}
