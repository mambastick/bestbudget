"use client"

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

const SECTIONS = [
  { type: "income", title: "Доходы" },
  { type: "expense", title: "Обязательные платежи и расходы" },
  { type: "transfer", title: "Переводы" },
] as const

export function RulesList({ rules }: { rules: RuleListItem[] }) {
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
                  ежемесячно: <Money value={monthlyTotal} currency={currency} className="font-medium text-foreground" />
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
                завершена
              </Badge>
            ) : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {describeSchedule(rule)}
            {rule.endDate ? ` · до ${formatDateFull(rule.endDate)}` : ""}
            {item.nextDate ? ` · следующая ${formatDay(item.nextDate)}` : ""}
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
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Действия" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => ops.openRule(rule)}>
            <Pencil /> Изменить расписание
          </DropdownMenuItem>
          {!item.finished ? (
            <DropdownMenuItem onClick={() => setConfirm("stop")}>
              <Square /> Остановить с сегодняшнего дня
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm("delete")}>
            <Trash2 /> Удалить расписание
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm === "stop"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Остановить регулярную операцию?"
        description={`Будущие неподтверждённые операции после ${formatDateFull(today)} будут удалены. Выполненные останутся в истории.`}
        confirmLabel="Остановить"
        onConfirm={() => run(() => stopRuleAction(rule.id), { success: "Регулярная операция остановлена" })}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Удалить расписание?"
        description="Все запланированные операции расписания будут удалены. Подтверждённые операции сохранятся в истории."
        onConfirm={() => run(() => deleteRuleAction(rule.id), { success: "Расписание удалено" })}
      />
    </li>
  )
}
