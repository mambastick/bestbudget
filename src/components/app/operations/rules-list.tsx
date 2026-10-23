"use client"

import { useTranslations, useLocale } from "next-intl"
import { MoreHorizontal, Pencil, Square, Trash2 } from "lucide-react"
import { useState } from "react"
import { deleteRuleAction, stopRuleAction } from "@/app/actions/finance"
import { CategoryIcon } from "@/components/app/category-icon"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Money } from "@/components/app/money"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { describeSchedule } from "@/domain/recurrence"
import { useAction } from "@/hooks/use-action"
import { formatDateFull, formatDay } from "@/lib/dates"
import { useCatalog } from "./catalog-context"
import { useOperations } from "./operations-provider"
import type { RuleRow } from "./types"

export interface RuleListItem {
  rule: RuleRow
  categoryIcon: string | null
  categoryColor: string | null
  categoryName: string | null
  accountName: string
  finished: boolean
  nextDate: string | null
}

export function RulesList({ rules }: { rules: RuleListItem[] }) {
  const t = useTranslations("recurring")
  const SECTIONS = [
    { type: "income", title: t("income") },
    { type: "expense", title: t("expense") },
    { type: "transfer", title: t("transfer") },
  ] as const
  const { currency, accounts } = useCatalog()
  return (
    <div className="grid grid-cols-1 gap-6">
      {SECTIONS.map((section) => {
        const items = rules.filter((r) => r.rule.type === section.type)
        if (items.length === 0) return null
        const monthlyTotal = items
          .filter((r) => !r.finished && r.rule.frequency === "monthly" && r.rule.interval === 1 && accounts.find((a) => a.id === r.rule.accountId)?.currency === currency)
          .reduce((s, r) => s + r.rule.amount, 0)
        return (
          <section key={section.type}>
            <div className="mb-1.5 flex items-baseline justify-between px-1 text-xs text-muted-foreground">
              <span className="font-medium tracking-wide uppercase">{section.title}</span>
              {monthlyTotal > 0 && items.every((r) => accounts.find((a) => a.id === r.rule.accountId)?.currency === currency) ? (
                <span>
                  {t.rich("monthlyAmount", { amount: () => <Money value={monthlyTotal} currency={currency} className="font-medium text-foreground" /> })}
                </span>
              ) : null}
            </div>
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {items.map((item) => (
                <RuleItem key={item.rule.id} item={item} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

function RuleItem({ item }: { item: RuleListItem }) {
  const t = useTranslations("recurring")
  const locale = useLocale()
  const { rule } = item
  const ops = useOperations()
  const { accounts, today } = useCatalog()
  const currency = accounts.find((a) => a.id === rule.accountId)!.currency
  const { run } = useAction()
  const [confirm, setConfirm] = useState<"stop" | "delete" | null>(null)

  return (
    <li className="flex items-center gap-3 px-3 py-3 sm:px-4">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => ops.openRule(rule)}>
        <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} transfer={rule.type === "transfer"} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{rule.title}</span>
            {item.finished ? (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                {t("finished")}
              </Badge>
            ) : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {describeSchedule(rule, locale)}
            {rule.endDate ? t("until", { date: formatDateFull(rule.endDate, locale) }) : ""}
            {item.nextDate ? t("nextDate", { date: formatDay(item.nextDate, locale) }) : ""}
          </span>
        </span>
      </button>
      <Money
        value={rule.amount}
        kind={rule.type === "transfer" ? undefined : rule.type}
        tone={rule.type === "income" ? "income" : "neutral"}
        currency={currency}
        className="text-sm font-semibold"
      />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("actions")} />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => ops.openRule(rule)}>
            <Pencil /> {t("editSchedule")}
          </DropdownMenuItem>
          {!item.finished ? (
            <DropdownMenuItem onClick={() => setConfirm("stop")}>
              <Square /> {t("stopToday")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm("delete")}>
            <Trash2 /> {t("deleteSchedule")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm === "stop"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("stopTitle")}
        description={t("stopDescription", { date: formatDateFull(today, locale) })}
        confirmLabel={t("stop")}
        onConfirm={() => run(() => stopRuleAction(rule.id), { success: t("stopped") })}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t("deleteTitle")}
        description={t("deleteDescription")}
        onConfirm={() => run(() => deleteRuleAction(rule.id), { success: t("deleted") })}
      />
    </li>
  )
}
