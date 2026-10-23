"use client"

import { useState } from "react"
import {
  automateGoalAction,
  contributeToGoalAction,
  setGoalArchivedAction,
  stopGoalAutomationAction,
  transferToGoalAction,
} from "@/app/actions/goals"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { DateField } from "@/components/app/date-field"
import { LinkButton } from "@/components/app/link-button"
import { MoneyInput } from "@/components/app/money-input"
import { Segmented } from "@/components/app/segmented"
import { Section } from "@/components/app/settings/section"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAction } from "@/hooks/use-action"
import { automaticGoalSchedule } from "@/domain/goals"
import { formatDateFull } from "@/lib/dates"
import { formatMoney, parseMoney } from "@/lib/money"
import type { getGoalDetail, GoalSummary } from "@/server/services/goals"
import { GoalCard } from "./goal-card"
import { GoalChart } from "./goal-chart"
import { AccountSelect, GoalEditor, type GoalAccount } from "./goal-editor"

export function GoalDetail({
  detail: d,
  accounts,
  canWrite,
}: {
  detail: Awaited<ReturnType<typeof getGoalDetail>>
  accounts: GoalAccount[]
  canWrite: boolean
}) {
  const g = d.goal
  const [mode, setMode] = useState<"edit" | "contribute" | "auto" | null>(null)
  const { run, pending } = useAction()
  const active = g.status !== "archived"
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <GoalCard goal={g} />
        <div className="grid grid-cols-1 gap-3 rounded-xl border p-5 text-sm">
          <p>
            Осталось: <strong>{g.target === null || g.progress === null ? "Нужен курс" : formatMoney(g.remaining, g.currency)}</strong>
          </p>
          <p>
            Средний темп за последние 3 месяца: <strong>{formatMoney(g.monthlyPace, g.currency)}/мес</strong>
          </p>
          <p>
            При текущем темпе: <strong>{g.historicalDate ? formatDateFull(g.historicalDate) : "Пока нет даты достижения"}</strong>
          </p>
          {d.hasPlan ? (
            <p>
              По плановым переводам:{" "}
              <strong>{g.plannedDate ? formatDateFull(g.plannedDate) : "Цель не достигается на горизонте 10 лет"}</strong>
            </p>
          ) : null}
          {g.kind === "account" ? (
            <p className="text-xs text-muted-foreground">
              Единственная цель без лимита получает весь баланс. Средства общего счёта распределяются по приоритету до суммы цели или
              лимита. Снятие денег уменьшает прогресс. Архивная цель освобождает распределение.
            </p>
          ) : null}
          {active && g.kind === "account" && g.fundingGap === null && g.progress !== null ? (
            <p className="text-xs text-muted-foreground">
              Для автопополнения лимит распределения должен покрывать всю цель, а курсы вышестоящих целей — быть известны.
            </p>
          ) : null}
          {g.expenseMonths ? (
            <p className="text-xs text-muted-foreground">
              Подушка: {g.expenseMonths} мес. × средние расходы за {g.expenseWindow} полных месяцев.{" "}
              {g.target === 0 ? "Добавьте расходы за прошлые месяцы, чтобы рассчитать сумму." : ""}
            </p>
          ) : null}
        </div>
      </div>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          {active ? (
            <>
              <Button onClick={() => setMode("contribute")}>Пополнить</Button>
              <Button variant="outline" onClick={() => setMode("edit")}>
                Изменить
              </Button>
              {g.kind === "account" && !g.automation ? (
                <Button
                  variant="outline"
                  onClick={() => setMode("auto")}
                  disabled={!g.targetDate || !g.monthlyRequired || g.progress === null || g.fundingGap === null}
                >
                  Откладывать автоматически
                </Button>
              ) : null}
              {g.automation ? (
                <>
                  <LinkButton variant="outline" href="/transactions?tab=rules">
                    Регулярные операции
                  </LinkButton>
                  <ConfirmDialog
                    title="Отключить автопополнение?"
                    description="Будущие переводы будут удалены. Выполненные переводы останутся в истории."
                    confirmLabel="Отключить"
                    destructive={false}
                    trigger={
                      <Button variant="outline" disabled={pending}>
                        Отключить автопополнение
                      </Button>
                    }
                    onConfirm={() => run(() => stopGoalAutomationAction(g.id), { success: "Автопополнение отключено" })}
                  />
                </>
              ) : null}
            </>
          ) : null}
          <ConfirmDialog
            title={active ? "Архивировать цель?" : "Восстановить цель?"}
            description={
              active
                ? "Будущие автопополнения прекратятся, история сохранится. Средства счёта станут доступны другим целям."
                : "Цель снова участвует в распределении счёта. Автопополнение можно настроить заново."
            }
            confirmLabel={active ? "Архивировать" : "Восстановить"}
            destructive={false}
            trigger={
              <Button variant="outline" disabled={pending}>
                {active ? "Архивировать" : "Восстановить"}
              </Button>
            }
            onConfirm={() =>
              run(() => setGoalArchivedAction(g.id, g.version, active), { success: active ? "Цель в архиве" : "Цель восстановлена" })
            }
          />
        </div>
      ) : null}
      <Section
        title="Как растут накопления"
        description="Факт и два отдельных сценария: средний темп за 3 месяца и плановые операции. Они не складываются. Прогноз ограничен 10 годами; будущие курсы и сумма подушки зафиксированы на сегодня."
      >
        <GoalChart data={d.chart} currency={g.currency} target={g.target} />
      </Section>
      <Section
        title="История пополнений"
        description={
          g.kind === "account"
            ? "Изменения выделенной цели суммы по датам операций счёта. История оценивается по текущему курсу и текущему распределению."
            : "Взносы и изъятия из ручной копилки. Для исправления добавьте обратный взнос с комментарием."
        }
      >
        {d.history.length ? (
          <ul className="grid grid-cols-1 divide-y">
            {d.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p>{formatDateFull(h.date)}</p>
                  <p className="text-xs text-muted-foreground break-words">{h.comment}</p>
                </div>
                <span className="font-medium tabular">{formatMoney(h.amount, g.currency, { sign: true })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">Пополнений пока нет.</p>
        )}
      </Section>
      {mode === "edit" ? (
        <GoalEditor goal={g} accounts={accounts} today={d.today} currency={g.currency} onClose={() => setMode(null)} />
      ) : null}
      {mode === "contribute" || mode === "auto" ? (
        <FundingForm mode={mode} goal={g} accounts={accounts} today={d.today} onClose={() => setMode(null)} />
      ) : null}
    </div>
  )
}

function FundingForm({
  mode,
  goal: g,
  accounts,
  today,
  onClose,
}: {
  mode: "contribute" | "auto"
  goal: GoalSummary
  accounts: GoalAccount[]
  today: string
  onClose: () => void
}) {
  const { run, pending } = useAction()
  const sources = accounts.filter((a) => a.id !== g.accountId && a.kind !== "loan" && !a.archivedAt)
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "")
  const source = sources.find((a) => a.id === sourceId)
  const manual = g.kind === "manual"
  const [amount, setAmount] = useState("")
  const [toAmount, setToAmount] = useState("")
  const [direction, setDirection] = useState("add")
  const [date, setDate] = useState<string | null>(today)
  const [comment, setComment] = useState("")
  const [day, setDay] = useState(5)
  const [error, setError] = useState("")
  const schedule =
    mode === "auto" && g.targetDate && g.fundingGap !== null ? automaticGoalSchedule(today, g.targetDate, day, g.fundingGap) : null
  const crossCurrency = !manual && source?.currency !== g.accountCurrency
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const success = { success: mode === "auto" ? "Автопополнение настроено" : "Пополнение записано", onSuccess: onClose }
    if (mode === "auto") {
      run(() => automateGoalAction(g.id, { accountId: sourceId, day, version: g.version }), success)
      return
    }
    const parsed = parseMoney(amount, manual ? g.currency : (source?.currency ?? g.currency))
    const received = crossCurrency ? parseMoney(toAmount, g.accountCurrency!) : undefined
    if (!parsed || !date || (crossCurrency && !received)) {
      setError("Укажите сумму и дату, для валютного перевода — сумму зачисления.")
      return
    }
    if (manual) run(() => contributeToGoalAction(g.id, { amount: direction === "take" ? -parsed : parsed, date, comment }), success)
    else run(() => transferToGoalAction(g.id, { accountId: sourceId, amount: parsed, toAmount: received ?? undefined, date }), success)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="grid grid-cols-1 gap-4">
          <DialogHeader>
            <DialogTitle>{mode === "auto" ? "Откладывать автоматически" : "Пополнить цель"}</DialogTitle>
            <DialogDescription>
              {mode === "auto"
                ? "Создадим ежемесячные плановые переводы до срока цели. Сумма рассчитана по числу оставшихся пополнений; каждый перевод нужно подтвердить."
                : manual
                  ? "Запишите взнос или сумму, взятую из копилки."
                  : "Выполненный перевод на накопительный счёт. Средства распределятся между целями по приоритету."}
            </DialogDescription>
          </DialogHeader>
          {!manual ? (
            <Field>
              <FieldLabel htmlFor="fund-source">Счёт списания</FieldLabel>
              <AccountSelect id="fund-source" value={sourceId} onChange={setSourceId} accounts={sources} />
              {!sources.length ? (
                <p className="text-sm text-muted-foreground">
                  Нужен другой активный счёт.{" "}
                  <LinkButton href="/accounts" variant="link">
                    Счета
                  </LinkButton>
                </p>
              ) : null}
            </Field>
          ) : null}
          {mode === "auto" ? (
            <>
              <Field>
                <FieldLabel htmlFor="fund-day">День месяца</FieldLabel>
                <Input id="fund-day" type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))} required />
              </Field>
              <p className="text-sm text-muted-foreground">
                Зачисление:{" "}
                {schedule
                  ? `${formatMoney(schedule.amount, g.accountCurrency!)} × ${schedule.count} пополнений`
                  : "Нет доступных дат до срока цели"}
                . Сумма учитывает недостающие средства более приоритетных целей общего счёта. Курс фиксируется при создании; при
                подтверждении перевода его можно уточнить.
              </p>
            </>
          ) : (
            <>
              {manual ? (
                <Segmented
                  value={direction}
                  onChange={setDirection}
                  options={[
                    { value: "add", label: "Внести" },
                    { value: "take", label: "Взять из копилки" },
                  ]}
                />
              ) : null}
              <Field>
                <FieldLabel htmlFor="fund-amount">{manual ? "Сумма" : "Сумма списания"}</FieldLabel>
                <MoneyInput
                  id="fund-amount"
                  value={amount}
                  onChange={setAmount}
                  currency={manual ? g.currency : source?.currency}
                  required
                />
              </Field>
              {crossCurrency ? (
                <Field>
                  <FieldLabel htmlFor="fund-received">Сумма зачисления</FieldLabel>
                  <MoneyInput id="fund-received" value={toAmount} onChange={setToAmount} currency={g.accountCurrency!} required />
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="fund-date">Дата</FieldLabel>
                <DateField id="fund-date" value={date} today={today} onChange={setDate} />
              </Field>
              {manual ? (
                <Field>
                  <FieldLabel htmlFor="fund-comment">Комментарий</FieldLabel>
                  <Input id="fund-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
                </Field>
              ) : null}
            </>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={pending || (!manual && !sourceId) || (mode === "auto" && !schedule)}>
              {mode === "auto" ? "Настроить" : "Записать"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
