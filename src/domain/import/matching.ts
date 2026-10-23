import { createHash } from "node:crypto"
import { diffDays } from "@/lib/dates"
import type { IncomingRow } from "./types"

export function fingerprint(accountId: string, row: IncomingRow): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        accountId,
        row.currency,
        row.amountMinorSigned,
        row.effectiveDate,
        row.operationAtRaw?.trim().replace(/\s+/g, " "),
        row.descriptionNormalized,
        row.externalId,
        row.exportStatus && row.exportStatus !== "posted" ? row.exportStatus : null,
      ]),
    )
    .digest("hex")
}

/** Each prior occurrence consumes exactly one incoming occurrence; identical purchases remain legal. */
export function reconcileMultiset(incoming: string[], existing: string[]): boolean[] {
  const counts = new Map<string, number>()
  for (const fp of existing) counts.set(fp, (counts.get(fp) ?? 0) + 1)
  return incoming.map((fp) => {
    const count = counts.get(fp) ?? 0
    if (count) counts.set(fp, count - 1)
    return count > 0
  })
}

export function isTransferPair(
  a: { accountId: string | null; normalized: IncomingRow },
  b: { accountId: string | null; normalized: IncomingRow },
  days = 2,
): boolean {
  const x = a.normalized,
    y = b.normalized
  return !!(
    a.accountId &&
    b.accountId &&
    a.accountId !== b.accountId &&
    x.currency === y.currency &&
    x.amountMinorSigned &&
    x.amountMinorSigned === -(y.amountMinorSigned ?? 0) &&
    x.effectiveDate &&
    y.effectiveDate &&
    Math.abs(diffDays(x.effectiveDate, y.effectiveDate)) <= days &&
    x.status === "posted" &&
    y.status === "posted" &&
    !x.errors.length &&
    !y.errors.length
  )
}
