"use client"

import { Repeat } from "lucide-react"
import { CategoryIcon } from "@/components/app/category-icon"
import { Money } from "@/components/app/money"
import { Badge } from "@/components/ui/badge"
import { formatDay, formatWeekday, type IsoDate } from "@/lib/dates"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import { useCatalog } from "./catalog-context"
import { OperationMenu } from "./operation-menu"
import { useOperations } from "./operations-provider"
import type { OperationRow } from "./types"

export type ListRow = OperationRow & {
  categoryName: string | null
  categoryIcon: string | null
  categoryColor: string | null
  accountName: string
  toAccountName: string | null
  authorName: string | null
}

/** Operations grouped by day with a net total per day. */
export function TransactionList({ rows, today }: { rows: ListRow[]; today: IsoDate }) {
  const groups = new Map<string, ListRow[]>()
  for (const r of rows) groups.set(r.date, [...(groups.get(r.date) ?? []), r])
  const { currency, accounts } = useCatalog()

  return (
    <div className="grid grid-cols-1 gap-5">
      {[...groups.entries()].map(([date, items]) => {
        const net = items.filter((i) => i.status === "posted" && accounts.find((a) => a.id === i.accountId)?.currency === currency).reduce((s, i) => s + (i.loanId ? -(i.loanInterest ?? 0) : i.type === "income" ? i.amount : i.type === "expense" ? -i.amount : 0), 0)
        return (
          <section key={date}>
            <div className="mb-1.5 flex items-baseline justify-between px-1 text-xs text-muted-foreground">
              <span className="font-medium tracking-wide uppercase">
                {date === today ? "Сегодня" : formatDay(date)} · {formatWeekday(date)}
              </span>
              {net !== 0 && items.every((i) => accounts.find((a) => a.id === i.accountId)?.currency === currency) ? <Money value={net} currency={currency} tone="neutral" className="text-xs" /> : null}
            </div>
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {items.map((r) => (
                <TransactionItem key={r.id} row={r} today={today} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

export function TransactionItem({ row, today }: { row: ListRow; today: IsoDate }) {
  const ops = useOperations()
  const { accounts } = useCatalog()
  const currency = accounts.find((a) => a.id === row.accountId)!.currency
  const toCurrency = accounts.find((a) => a.id === row.toAccountId)?.currency
  const planned = row.status === "planned"
  const subtitle =
    row.loanId ? `тело ${formatMoney(row.loanPrincipal ?? 0, currency)} + проценты ${formatMoney(row.loanInterest ?? 0, currency)}` : row.type === "transfer" ? `${row.accountName} → ${row.toAccountName}` : [row.categoryName, row.accountName].filter(Boolean).join(" · ")
  return (
    <li className={cn("flex items-center gap-3 px-3 py-2.5 sm:px-4", row.status === "skipped" && "opacity-50")}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => ops.openEdit(row)}>
        <CategoryIcon icon={row.categoryIcon} color={row.categoryColor} transfer={row.type === "transfer"} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{row.title}</span>
            {row.recurringRuleId ? <Repeat className="size-3 shrink-0 text-muted-foreground" aria-label="Регулярная" /> : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {subtitle}
            {row.authorName ? ` · ${row.authorName}` : ""}
          </span>
        </span>
      </button>
      <div className="flex flex-col items-end gap-0.5">
        <Money
          value={row.amount}
          kind={row.type === "transfer" ? undefined : row.type}
          tone={planned || row.type === "transfer" ? "neutral" : row.type}
          currency={currency}
          className={cn("text-sm font-semibold", planned && "text-muted-foreground")}
        />
        {row.toAmount && toCurrency ? <span className="text-xs text-muted-foreground">→ <Money value={row.toAmount} currency={toCurrency} /></span> : null}
        {planned ? (
          <Badge variant={row.date < today ? "destructive" : "outline"} className="h-4 px-1.5 text-[10px]">
            {row.date < today ? "просрочено" : "план"}
          </Badge>
        ) : row.status === "skipped" ? (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
            пропущено
          </Badge>
        ) : null}
      </div>
      <OperationMenu row={row} />
    </li>
  )
}
