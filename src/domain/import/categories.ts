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
const MCC: Record<string, string> = {
  "5411": "Продукты",
  "5499": "Продукты",
  "5812": "Рестораны и доставка",
  "5814": "Рестораны и доставка",
  "4111": "Транспорт",
  "4121": "Транспорт",
  "5541": "Автомобиль",
  "5542": "Автомобиль",
  "5912": "Здоровье",
  "8011": "Здоровье",
  "5651": "Одежда",
  "8299": "Образование",
}

export function compileRule(pattern: string) {
  if (!pattern || pattern.length > 200) throw new Error("Регулярное выражение: от 1 до 200 символов")
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
  for (const rule of [...rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
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
    return { categoryId: rule.categoryId, source: `Правило v${rule.version} (приоритет ${rule.priority})` }
  }
  const mcc = kind === "expense" && row.mcc ? active.find((c) => c.name === MCC[row.mcc!]) : undefined
  if (mcc) return { categoryId: mcc.id, source: `MCC ${row.mcc}` }
  const bank = row.bankCategory ? active.find((c) => normalizeDescription(c.name) === normalizeDescription(row.bankCategory!)) : undefined
  if (bank) return { categoryId: bank.id, source: "Категория банка — проверьте" }
  return { categoryId: null, source: row.bankCategory ? `Подсказка банка: ${row.bankCategory}` : null }
}
