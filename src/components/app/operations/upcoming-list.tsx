"use client"

import { useTranslations, useLocale } from "next-intl"
import { Check } from "lucide-react"
import { getTransactionAction } from "@/app/actions/finance"
import { Money } from "@/components/app/money"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatMoney } from "@/lib/money"
import { formatDayShort, formatWeekday } from "@/lib/dates"
import { useOperations } from "./operations-provider"

export interface UpcomingEntry {
  key: string
  id: string | null
  loanId?: string | null
  loanPrincipal?: number
  loanInterest?: number
  ruleId: string | null
  date: string
  type: "income" | "expense" | "transfer"
  amount: number
  currency: string
  title: string
  categoryIcon: string | null
  categoryColor: string | null
  overdue: boolean
}

/** Nearest planned operations with one-click confirmation. */
export function UpcomingList({ items }: { items: UpcomingEntry[] }) {
  const t = useTranslations("transactions")
  const locale = useLocale()
  const ops = useOperations()

  async function act(item: UpcomingEntry, then: "edit" | "confirm") {
    if (item.id) {
      const res = await getTransactionAction(item.id)
      if (!res.ok) return
      if (then === "confirm") ops.openConfirm(res.data)
      else ops.openEdit(res.data)
    } else if (item.loanId) {
      ops.openLoan(item.loanId, item.date)
    } else if (item.ruleId) {
      ops.openVirtual(item.ruleId, item.date, then)
    }
  }

  return (
    <ul className="divide-y">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-2">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left" onClick={() => act(item, "edit")}>
            <span className="w-8 shrink-0 text-center leading-tight">
              <span className="block text-sm font-semibold">{Number(item.date.slice(8))}</span>
              <span className="block text-[10px] text-muted-foreground uppercase">{formatWeekday(item.date, locale)}</span>
            </span>
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.categoryColor ?? "var(--muted-foreground)" }} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{item.title}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {formatDayShort(item.date, locale)}
                {item.overdue ? (
                  <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                    {t("overdue")}
                  </Badge>
                ) : null}
              </span>
              {item.loanId ? <span className="block truncate text-xs text-muted-foreground">{t("loanSplit", { principal: formatMoney(item.loanPrincipal ?? 0, item.currency, { locale }), interest: formatMoney(item.loanInterest ?? 0, item.currency, { locale }) })}</span> : null}
            </span>
            <Money
              value={item.amount}
              kind={item.type === "transfer" ? undefined : item.type}
              tone={item.type === "income" ? "income" : "neutral"}
              currency={item.currency}
              className="text-sm font-medium"
            />
          </button>
          <Button variant="ghost" size="icon-sm" aria-label={t("confirm")} title={t("confirmPosted")} onClick={() => act(item, "confirm")}>
            <Check />
          </Button>
        </li>
      ))}
    </ul>
  )
}
