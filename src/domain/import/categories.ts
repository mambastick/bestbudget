import ru from "../../../messages/ru/onboarding.json"
import en from "../../../messages/en/onboarding.json"
import { importMessage } from "./messages"
import { RE2JS } from "re2js"
import type { IncomingRow } from "./types"
import { normalizeDescription } from "./normalize"

export interface CategoryRule {
  id: string
  version: number
  categoryId: string
  descriptionMode: "substring" | "regex"
  descriptionPattern: string | null
  mcc: string | null
  currency?: string | null
  minAmount: number | null
  maxAmount: number | null
  priority: number
}
const MCC: Record<string, keyof typeof ru.defaults.expense> = {
  "5411": "groceries",
  "5499": "groceries",
  "5812": "dining",
  "5814": "dining",
  "4111": "transport",
  "4121": "transport",
  "5541": "car",
  "5542": "car",
  "5912": "health",
  "8011": "health",
  "5651": "clothing",
  "8299": "education",
}

export function compileRule(pattern: string) {
  if (!pattern || pattern.length > 200) throw new Error(importMessage("regexLength"))
  return RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE)
}

export function suggestCategory(
  row: IncomingRow,
  rules: CategoryRule[],
  categories: { id: string; name: string; kind: string; archivedAt: Date | null }[],
) {
  const kind = (row.amountMinorSigned ?? 0) < 0 ? "expense" : "income"
  const active = categories.filter((c) => c.kind === kind && !c.archivedAt)
  const amount = Math.abs(row.amountMinorSigned ?? 0)
  for (const rule of [...rules].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (
      !active.some((c) => c.id === rule.categoryId) ||
      (rule.currency && rule.currency !== row.currency) ||
      (rule.mcc && rule.mcc !== row.mcc) ||
      (rule.minAmount !== null && amount < rule.minAmount) ||
      (rule.maxAmount !== null && amount > rule.maxAmount)
    )
      continue
    if (rule.descriptionPattern) {
      const matches =
        rule.descriptionMode === "regex"
          ? compileRule(rule.descriptionPattern).test(row.descriptionNormalized)
          : row.descriptionNormalized.includes(normalizeDescription(rule.descriptionPattern))
      if (!matches) continue
    }
    return { categoryId: rule.categoryId, source: importMessage("rule", { version: rule.version, priority: rule.priority }) }
  }
  const mcc =
    kind === "expense" && row.mcc
      ? active.find((c) => {
          const key = MCC[row.mcc!]
          return key && [ru.defaults.expense[key], en.defaults.expense[key]].includes(c.name)
        })
      : undefined
  if (mcc) return { categoryId: mcc.id, source: importMessage("mcc", { mcc: row.mcc! }) }
  const bank = row.bankCategory ? active.find((c) => normalizeDescription(c.name) === normalizeDescription(row.bankCategory!)) : undefined
  if (bank) return { categoryId: bank.id, source: importMessage("bankCategory") }
  return { categoryId: null, source: row.bankCategory ? importMessage("bankHint", { category: row.bankCategory }) : null }
}
