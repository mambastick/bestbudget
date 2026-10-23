import type { ProposalItem } from "./types"

/** Changed fields plus financial/date context; internal metadata stays out of cards. */
export function proposalChanges(item: ProposalItem) {
  return Object.entries(item.after)
    .filter(
      ([key, value]) =>
        !["id", "version", "householdId"].includes(key) &&
        value !== undefined &&
        (!item.before ||
          ["amount", "targetAmount", "openingBalance", "toAmount", "date", "startDate", "endDate", "targetDate"].includes(key) ||
          JSON.stringify(item.before[key]) !== JSON.stringify(value)),
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
