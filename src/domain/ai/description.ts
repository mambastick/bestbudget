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
