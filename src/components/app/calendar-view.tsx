"use client"

import { AlertTriangle, Check, Plus } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useState } from "react"
import { getTransactionAction } from "@/app/actions/finance"
import { CategoryIcon } from "@/components/app/category-icon"
import { Money } from "@/components/app/money"
import { useCatalog } from "@/components/app/operations/catalog-context"
import { useOperations } from "@/components/app/operations/operations-provider"
import { Segmented } from "@/components/app/segmented"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDateFull, formatDay, formatWeekday, weekday, type IsoDate } from "@/lib/dates"
import { currencySymbol } from "@/lib/currencies"
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
  currency: string
  toAmount: number | null
  toCurrency: string | null
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
const MAX_CHIPS = 3
const TRANSFER_COLOR = "#64748b"

function entryColor(e: CalendarEntry) {
  if (e.type === "transfer") return TRANSFER_COLOR
  return e.categoryColor ?? (e.type === "income" ? "#16a34a" : "#dc2626")
}

/** Opens an entry for editing or confirmation; projected (virtual) entries get a row first. */
function useOpenEntry() {
  const ops = useOperations()
  return async (e: CalendarEntry, then: "edit" | "confirm") => {
    if (e.virtual && e.recurringRuleId) return ops.openVirtual(e.recurringRuleId, e.date, then)
    const res = await getTransactionAction(e.id)
    if (!res.ok) return
    if (then === "confirm") ops.openConfirm(res.data)
    else ops.openEdit(res.data)
  }
}

export function CalendarView({ days, items, today, initialDay }: { days: CalendarDay[]; items: CalendarEntry[]; today: IsoDate; initialDay: IsoDate }) {
  const [selected, setSelected] = useState<IsoDate>(initialDay)
  const [view, setView] = useState<"month" | "list">("month")
  const byDate = new Map<IsoDate, CalendarEntry[]>()
  for (const i of items) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i])
  // Income first, then expenses; larger amounts first — the important things stay visible in a busy cell.
  for (const list of byDate.values()) list.sort((a, b) => (a.type === "income" ? 0 : 1) - (b.type === "income" ? 0 : 1) || b.amount - a.amount)
  const selectedDay = days.find((d) => d.date === selected) ?? days[0]!
  const negativeDays = days.filter((d) => d.date >= today && d.balance < 0)

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Legend />
        <Segmented
          value={view}
          onChange={setView}
          size="sm"
          className="w-auto"
          options={[
            { value: "month", label: "Месяц" },
            { value: "list", label: "Список" },
          ]}
        />
      </div>

      {negativeDays.length > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>
            Прогноз уходит в минус с {formatDay(negativeDays[0]!.date)} ({negativeDays.length} {plural(negativeDays.length, "день", "дня", "дней")}). Такие дни
            выделены красным — перенесите платёж или пополните счёт заранее.
          </span>
        </div>
      ) : null}

      {view === "month" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <MonthGrid days={days} byDate={byDate} today={today} selected={selected} onSelect={setSelected} />
          <DayPanel day={selectedDay} entries={byDate.get(selectedDay.date) ?? []} today={today} />
        </div>
      ) : (
        <AgendaList days={days} byDate={byDate} today={today} />
      )}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-[4px] border-l-[3px] border-l-foreground/60 bg-foreground/15" /> выполнено
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-[4px] border border-dashed border-foreground/40 bg-foreground/5" /> запланировано
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-5 rounded-[4px] bg-destructive/15 ring-1 ring-destructive/40" /> кассовый разрыв
      </span>
      <span>цвет — категория</span>
    </div>
  )
}

function MonthGrid({
  days,
  byDate,
  today,
  selected,
  onSelect,
}: {
  days: CalendarDay[]
  byDate: Map<IsoDate, CalendarEntry[]>
  today: IsoDate
  selected: IsoDate
  onSelect: (d: IsoDate) => void
}) {
  const leading = days.length > 0 ? weekday(days[0]!.date) - 1 : 0
  const trailing = (7 - ((leading + days.length) % 7)) % 7
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={cn("py-2", i >= 5 && "text-muted-foreground/70")}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
        {Array.from({ length: leading }, (_, i) => (
          <div key={`lead-${i}`} className="border-r border-b bg-muted/25" />
        ))}
        {days.map((d) => (
          <DayCell
            key={d.date}
            day={d}
            entries={byDate.get(d.date) ?? []}
            today={today}
            selected={selected === d.date}
            onSelect={() => onSelect(d.date)}
          />
        ))}
        {Array.from({ length: trailing }, (_, i) => (
          <div key={`trail-${i}`} className="border-r border-b bg-muted/25" />
        ))}
      </div>
    </div>
  )
}

function DayCell({
  day,
  entries,
  today,
  selected,
  onSelect,
}: {
  day: CalendarDay
  entries: CalendarEntry[]
  today: IsoDate
  selected: boolean
  onSelect: () => void
}) {
  const open = useOpenEntry()
  const { currency } = useCatalog()
  const negative = day.date >= today && day.balance < 0
  const isWeekend = weekday(day.date) >= 6
  const hidden = entries.length - MAX_CHIPS
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect())}
      aria-pressed={selected}
      aria-label={`${formatDateFull(day.date)}, операций: ${entries.length}`}
      className={cn(
        "group/day relative flex min-h-[4.5rem] cursor-pointer flex-col gap-1 border-r border-b p-1 text-left transition-colors outline-none sm:min-h-32 sm:p-1.5",
        isWeekend && "bg-muted/20",
        negative && "bg-destructive/[0.07]",
        "hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
        selected && "bg-primary/[0.06] ring-2 ring-primary ring-inset hover:bg-primary/[0.08]",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            day.date === today ? "bg-primary text-primary-foreground" : day.date < today ? "text-muted-foreground" : "",
          )}
        >
          {Number(day.date.slice(8))}
        </span>
        {day.date >= today ? (
          <span
            className={cn("tabular hidden truncate pt-1 text-[10px] sm:block", negative ? "font-semibold text-destructive" : "text-muted-foreground/80")}
            title="Прогноз остатка на конец дня"
          >
            {formatMoneyShort(day.balance, currency)}
          </span>
        ) : null}
      </div>

      {/* Phones: colored dots. */}
      {entries.length > 0 ? (
        <div className="flex flex-wrap gap-0.5 px-0.5 sm:hidden">
          {entries.slice(0, 6).map((e) => (
            <span
              key={e.key}
              className={cn("size-1.5 rounded-full", e.status === "planned" && "ring-1 ring-current ring-offset-0 opacity-60")}
              style={{ backgroundColor: entryColor(e), color: entryColor(e) }}
            />
          ))}
        </div>
      ) : null}
      {negative ? <span className="mt-auto truncate text-[10px] font-semibold text-destructive tabular sm:hidden">{formatMoneyShort(day.balance, currency)}</span> : null}

      {/* Larger screens: event chips, like meetings in a calendar. */}
      <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
        {entries.slice(0, MAX_CHIPS).map((e) => (
          <EventChip
            key={e.key}
            entry={e}
            overdue={e.status === "planned" && e.date < today}
            onOpen={(ev) => {
              ev.stopPropagation()
              void open(e, "edit")
            }}
          />
        ))}
        {hidden > 0 ? <span className="px-1 text-[11px] font-medium text-muted-foreground">+{hidden} ещё</span> : null}
      </div>
    </div>
  )
}

function EventChip({ entry: e, overdue, onOpen }: { entry: CalendarEntry; overdue: boolean; onOpen: (ev: React.MouseEvent) => void }) {
  const color = entryColor(e)
  const planned = e.status === "planned"
  const sign = e.type === "income" ? "+" : e.type === "expense" ? "−" : ""
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${e.title}: ${sign}${formatMoneyShort(e.amount, e.currency)} ${currencySymbol(e.currency)}${planned ? " (план)" : ""}`}
      className={cn(
        "flex min-w-0 flex-col rounded-[5px] border-l-[3px] px-1.5 py-0.5 text-left text-[11px] leading-tight transition-[filter] hover:brightness-95 dark:hover:brightness-125",
        planned && "border border-l-[3px] border-dashed",
        overdue && "ring-1 ring-destructive/60",
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${color} ${planned ? 8 : 18}%, transparent)`,
        borderColor: planned ? `color-mix(in oklab, ${color} 45%, transparent)` : undefined,
        borderLeftColor: color,
      }}
    >
      <span className={cn("truncate font-medium", planned && "text-foreground/80")}>{e.title}</span>
      <span className={cn("tabular truncate", e.type === "income" ? "text-income" : "text-foreground/70")}>
        {sign}
        {formatMoneyShort(e.amount, e.currency)} {currencySymbol(e.currency)}
      </span>
    </button>
  )
}

function DayPanel({ day, entries, today }: { day: CalendarDay; entries: CalendarEntry[]; today: IsoDate }) {
  const ops = useOperations()
  const { currency } = useCatalog()
  const plannedIncome = entries.filter((e) => e.status === "planned" && e.type === "income")
  const plannedOut = entries.filter((e) => e.status === "planned" && e.type !== "income")
  const posted = entries.filter((e) => e.status === "posted")
  const negative = day.balance < 0 && day.date >= today
  return (
    <div className="h-fit rounded-xl border bg-card xl:sticky xl:top-20">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={day.date}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="grid grid-cols-1 gap-4 p-4"
        >
          <div>
            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{formatWeekday(day.date)}</div>
            <div className="text-lg font-semibold">{formatDateFull(day.date)}</div>
            <div className={cn("mt-2 rounded-lg px-3 py-2 text-sm", negative ? "bg-destructive/10" : "bg-muted/60")}>
              <span className="text-muted-foreground">{day.date >= today ? "Прогноз остатка на конец дня" : "Остаток на конец дня"}</span>
              <div className="text-xl font-semibold">
                <Money value={day.balance} currency={currency} tone={negative ? "expense" : "neutral"} />
              </div>
            </div>
          </div>
          <Section title="Ожидаемые доходы" entries={plannedIncome} />
          <Section title="Ожидаемые платежи" entries={plannedOut} />
          <Section title="Выполнено" entries={posted} />
          {entries.length === 0 ? <p className="text-sm text-muted-foreground">В этот день операций нет.</p> : null}
          <Button variant="outline" onClick={() => ops.openCreate({ date: day.date })}>
            <Plus /> Добавить на эту дату
          </Button>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function Section({ title, entries }: { title: string; entries: CalendarEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</div>
      <ul className="grid grid-cols-1 gap-1">
        {entries.map((e) => (
          <EntryRow key={e.key} entry={e} />
        ))}
      </ul>
    </div>
  )
}

function EntryRow({ entry: e, today }: { entry: CalendarEntry; today?: IsoDate }) {
  const open = useOpenEntry()
  const color = entryColor(e)
  const overdue = today !== undefined && e.status === "planned" && e.date < today
  return (
    <li className="flex items-center gap-2 rounded-lg py-1 pr-1 pl-2 hover:bg-accent/50" style={{ boxShadow: `inset 3px 0 0 ${color}` }}>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => open(e, "edit")}>
        <CategoryIcon icon={e.categoryIcon} color={e.categoryColor} transfer={e.type === "transfer"} className="size-7" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{e.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {e.virtual
              ? "по расписанию"
              : [e.type === "transfer" ? `${e.accountName} → ${e.toAccountName}` : e.categoryName, e.authorName].filter(Boolean).join(" · ")}
            {overdue ? " · просрочено" : ""}
          </span>
        </span>
      </button>
      <Money
        value={e.amount}
        kind={e.type === "transfer" ? undefined : e.type}
        tone={e.type === "income" ? "income" : "neutral"}
        currency={e.currency}
        className="text-sm font-medium"
      />
      {e.status === "planned" ? (
        <Button variant="ghost" size="icon-sm" aria-label="Подтвердить" title="Подтвердить выполнение" onClick={() => open(e, "confirm")}>
          <Check />
        </Button>
      ) : (
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          факт
        </Badge>
      )}
    </li>
  )
}

/** Agenda: the month as a list of days that have operations, with the balance after each day. */
function AgendaList({ days, byDate, today }: { days: CalendarDay[]; byDate: Map<IsoDate, CalendarEntry[]>; today: IsoDate }) {
  const { currency } = useCatalog()
  const withEntries = days.filter((d) => (byDate.get(d.date)?.length ?? 0) > 0)
  if (withEntries.length === 0) {
    return <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">В этом месяце операций нет.</p>
  }
  return (
    <div className="grid grid-cols-1 gap-4">
      {withEntries.map((d) => {
        const negative = d.date >= today && d.balance < 0
        return (
          <section key={d.date} className={cn("rounded-xl border bg-card", negative && "border-destructive/40")}>
            <div className="flex items-baseline justify-between gap-2 border-b px-4 py-2">
              <span className="text-sm font-medium">
                {d.date === today ? "Сегодня, " : ""}
                {formatDay(d.date)} <span className="text-muted-foreground">· {formatWeekday(d.date)}</span>
              </span>
              <span className={cn("text-xs", negative ? "font-semibold text-destructive" : "text-muted-foreground")}>
                {d.date >= today ? "прогноз " : "остаток "}
                <Money value={d.balance} currency={currency} />
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-1 p-2">
              {byDate.get(d.date)!.map((e) => (
                <EntryRow key={e.key} entry={e} today={today} />
              ))}
            </ul>
          </section>
        )
      })}
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
