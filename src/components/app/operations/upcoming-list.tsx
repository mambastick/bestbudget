"use client"

import { Check, Pencil } from "lucide-react"
import { getTransactionAction } from "@/app/actions/finance"
import { CategoryIcon } from "@/components/app/category-icon"
import { Money } from "@/components/app/money"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDayShort, formatWeekday } from "@/lib/dates"
import { useCatalog } from "./catalog-context"
import { useOperations } from "./operations-provider"

export interface UpcomingEntry {
  key: string
  id: string | null
  ruleId: string | null
  date: string
  type: "income" | "expense" | "transfer"
  amount: number
  title: string
  categoryIcon: string | null
  categoryColor: string | null
  overdue: boolean
}

/** Nearest planned operations with one-click confirmation. */
export function UpcomingList({ items }: { items: UpcomingEntry[] }) {
  const ops = useOperations()
  const { currency } = useCatalog()

  async function act(item: UpcomingEntry, then: "edit" | "confirm") {
    if (item.id) {
      const res = await getTransactionAction(item.id)
      if (!res.ok) return
      if (then === "confirm") ops.openConfirm(res.data)
      else ops.openEdit(res.data)
    } else if (item.ruleId) {
      ops.openVirtual(item.ruleId, item.date, then)
    }
  }

  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-3 py-2.5">
          <div className="w-12 shrink-0 text-center leading-tight">
            <div className="text-sm font-semibold">{formatDayShort(item.date).split(" ")[0]}</div>
            <div className="text-[11px] text-muted-foreground uppercase">{formatDayShort(item.date).split(" ")[1]}</div>
          </div>
          <CategoryIcon icon={item.categoryIcon} color={item.categoryColor} transfer={item.type === "transfer"} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{item.title}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {formatWeekday(item.date)}
              {item.overdue ? (
                <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                  просрочено
                </Badge>
              ) : null}
            </div>
          </div>
          <Money value={item.amount} kind={item.type === "transfer" ? undefined : item.type} tone={item.type === "income" ? "income" : "neutral"} currency={currency} className="text-sm font-medium" />
          <div className="flex shrink-0">
            <Button variant="ghost" size="icon-sm" aria-label="Подтвердить" title="Подтвердить" onClick={() => act(item, "confirm")}>
              <Check />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Изменить" title="Изменить" onClick={() => act(item, "edit")}>
              <Pencil />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
