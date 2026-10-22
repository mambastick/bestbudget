"use client"

import { AlertTriangle, Check, Plus } from "lucide-react"
import { useState } from "react"
import { getTransactionAction } from "@/app/actions/finance"
import { CategoryIcon } from "@/components/app/category-icon"
import { Money } from "@/components/app/money"
import { useCatalog } from "@/components/app/operations/catalog-context"
import { useOperations } from "@/components/app/operations/operations-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDateFull, weekday, type IsoDate } from "@/lib/dates"
import { formatMoneyShort } from "@/lib/money"
import { cn } from "@/lib/utils"

export interface CalendarDay {
  date: IsoDate
  income: number
  expense: number
  balance: number
}

export interface CalendarEntry {
  key: string
  id: string
  virtual: boolean
  type: "income" | "expense" | "transfer"
  status: "planned" | "posted" | "skipped"
  amount: number
  title: string
  date: IsoDate
  categoryIcon: string | null
  categoryColor: string | null
  categoryName: string | null
  accountName: string
  toAccountName: string | null
  authorName: string | null
  recurringRuleId: string | null
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

export function CalendarView({ days, items, today, initialDay }: { days: CalendarDay[]; items: CalendarEntry[]; today: IsoDate; initialDay: IsoDate }) {
  const [selected, setSelected] = useState<IsoDate>(initialDay)
  const { currency } = useCatalog()
  const byDate = new Map<IsoDate, CalendarEntry[]>()
  for (const i of items) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i])
  const leading = days.length > 0 ? weekday(days[0]!.date) - 1 : 0
  const selectedDay = days.find((d) => d.date === selected) ?? days[0]!
  const negativeDays = days.filter((d) => d.date >= today && d.balance < 0)

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
      <div className="grid grid-cols-1 gap-3">
        {negativeDays.length > 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
            <span>
              Прогноз уходит в минус в {negativeDays.length} {plural(negativeDays.length, "день", "дня", "дней")} — начиная с{" "}
              {formatDateFull(negativeDays[0]!.date)}. Такие даты выделены красным.
            </span>
          </div>
        ) : null}
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-2">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: leading }, (_, i) => (
              <div key={`pad-${i}`} className="border-r border-b bg-muted/20" />
            ))}
            {days.map((d) => {
              const entries = byDate.get(d.date) ?? []
              const hasPlanned = entries.some((e) => e.status === "planned")
              const negative = d.date >= today && d.balance < 0
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => setSelected(d.date)}
                  aria-pressed={selected === d.date}
                  className={cn(
                    "relative flex min-h-16 flex-col items-stretch gap-0.5 border-r border-b p-1.5 text-left transition-colors hover:bg-accent/60 sm:min-h-24 sm:p-2 [&:nth-child(7n)]:border-r-0",
                    negative && "bg-destructive/8 hover:bg-destructive/12",
                    selected === d.date && "ring-2 ring-primary ring-inset",
                    d.date < today && "text-muted-foreground",
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span
                      className={cn(
                        "inline-flex size-6 items-center justify-center rounded-full text-xs font-medium",
                        d.date === today && "bg-primary text-primary-foreground",
                      )}
                    >
                      {Number(d.date.slice(8))}
                    </span>
                    {hasPlanned ? <span className="size-1.5 rounded-full bg-primary" aria-label="Есть плановые операции" /> : null}
                  </span>
                  <span className="hidden flex-col text-[11px] leading-tight sm:flex">
                    {d.income > 0 ? <span className="tabular truncate text-income">+{formatMoneyShort(d.income)}</span> : null}
                    {d.expense > 0 ? <span className="tabular truncate text-expense">−{formatMoneyShort(d.expense)}</span> : null}
                  </span>
                  {d.date >= today ? (
                    <span className={cn("tabular mt-auto truncate text-[10px] sm:text-[11px]", negative ? "font-semibold text-destructive" : "text-muted-foreground")}>
                      {formatMoneyShort(d.balance)}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          В ячейке — доходы, расходы и прогнозируемый остаток на конец дня. Точка означает запланированные операции.
        </p>
      </div>

      <DayPanel day={selectedDay} entries={byDate.get(selectedDay.date) ?? []} today={today} currency={currency} />
    </div>
  )
}

function DayPanel({ day, entries, today, currency }: { day: CalendarDay; entries: CalendarEntry[]; today: IsoDate; currency: string }) {
  const ops = useOperations()
  const plannedIncome = entries.filter((e) => e.status === "planned" && e.type === "income")
  const plannedExpense = entries.filter((e) => e.status === "planned" && e.type !== "income")
  const posted = entries.filter((e) => e.status === "posted")
  return (
    <Card className="h-fit lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle>{formatDateFull(day.date)}</CardTitle>
        <CardDescription>
          {day.date >= today ? "Прогноз остатка на конец дня" : "Остаток на конец дня"}:{" "}
          <Money value={day.balance} currency={currency} tone={day.balance < 0 ? "expense" : "neutral"} className="font-semibold text-foreground" />
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        <Section title="Ожидаемые доходы" entries={plannedIncome} currency={currency} />
        <Section title="Ожидаемые расходы" entries={plannedExpense} currency={currency} />
        <Section title="Выполненные операции" entries={posted} currency={currency} />
        {entries.length === 0 ? <p className="text-sm text-muted-foreground">Операций нет.</p> : null}
        <Button variant="outline" onClick={() => ops.openCreate({ date: day.date })}>
          <Plus /> Добавить на эту дату
        </Button>
      </CardContent>
    </Card>
  )
}

function Section({ title, entries, currency }: { title: string; entries: CalendarEntry[]; currency: string }) {
  const ops = useOperations()
  if (entries.length === 0) return null

  async function open(e: CalendarEntry, then: "edit" | "confirm") {
    if (e.virtual && e.recurringRuleId) return ops.openVirtual(e.recurringRuleId, e.date, then)
    const res = await getTransactionAction(e.id)
    if (!res.ok) return
    if (then === "confirm") ops.openConfirm(res.data)
    else ops.openEdit(res.data)
  }

  return (
    <div>
      <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</div>
      <ul className="grid grid-cols-1 gap-1">
        {entries.map((e) => (
          <li key={e.key} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/50">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => open(e, "edit")}>
              <CategoryIcon icon={e.categoryIcon} color={e.categoryColor} transfer={e.type === "transfer"} className="size-7" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{e.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {e.virtual ? "прогноз по расписанию" : [e.categoryName ?? (e.type === "transfer" ? `${e.accountName} → ${e.toAccountName}` : null), e.authorName].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
            <Money
              value={e.amount}
              kind={e.type === "transfer" ? undefined : e.type}
              tone={e.status === "posted" && e.type !== "transfer" ? e.type : "neutral"}
              currency={currency}
              className="text-sm font-medium"
            />
            {e.status === "planned" ? (
              <Button variant="ghost" size="icon-sm" aria-label="Подтвердить" title="Подтвердить" onClick={() => open(e, "confirm")}>
                <Check />
              </Button>
            ) : (
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                факт
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few
  return many
}
