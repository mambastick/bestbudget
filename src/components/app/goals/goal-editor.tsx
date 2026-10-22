"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createGoalAction, updateGoalAction } from "@/app/actions/goals"
import { CATEGORY_ICONS } from "@/components/app/category-icon"
import { CurrencySelect } from "@/components/app/currency-select"
import { DateField } from "@/components/app/date-field"
import { LinkButton } from "@/components/app/link-button"
import { MoneyInput } from "@/components/app/money-input"
import { Segmented } from "@/components/app/segmented"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAction } from "@/hooks/use-action"
import type { Currency } from "@/lib/currencies"
import { minorToInput, parseMoney } from "@/lib/money"
import type { GoalSummary } from "@/server/services/goals"

const GOAL_ICONS = {
  "piggy-bank": "Накопления",
  plane: "Отпуск",
  car: "Машина",
  home: "Дом",
  wrench: "Ремонт",
  "graduation-cap": "Образование",
  "heart-pulse": "Здоровье",
  gift: "Подарок",
  circle: "Другое",
}

export interface GoalAccount {
  id: string
  name: string
  currency: string
  kind: string
  archivedAt: Date | null
}

export function AccountSelect({
  id,
  value,
  accounts,
  onChange,
  disabled,
}: {
  id?: string
  value: string
  accounts: GoalAccount[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const items = accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))
  return (
    <Select value={value || null} onValueChange={(v) => v && onChange(v)} items={items} disabled={disabled}>
      <SelectTrigger id={id} className="w-full min-w-0">
        <SelectValue placeholder="Выберите счёт" />
      </SelectTrigger>
      <SelectContent>
        {items.map((a) => (
          <SelectItem key={a.value} value={a.value}>
            {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function GoalEditor({
  goal,
  accounts,
  today,
  currency,
  onClose,
}: {
  goal: GoalSummary | null
  accounts: GoalAccount[]
  today: string
  currency: string
  onClose: () => void
}) {
  const router = useRouter()
  const { pending, run } = useAction()
  const [name, setName] = useState(goal?.name ?? "")
  const [kind, setKind] = useState<"account" | "manual">(goal?.kind ?? "account")
  const [cur, setCur] = useState(goal?.currency ?? currency)
  const [target, setTarget] = useState(goal ? minorToInput(goal.targetAmount, goal.currency) : "")
  const [date, setDate] = useState<string | null>(goal?.targetDate ?? null)
  const [accountId, setAccountId] = useState(goal?.accountId ?? "")
  const [emergency, setEmergency] = useState(goal?.expenseMonths ? "emergency" : "fixed")
  const [months, setMonths] = useState(goal?.expenseMonths ?? 6)
  const [window, setWindow] = useState<3 | 6>(goal?.expenseWindow === 6 ? 6 : 3)
  const [priority, setPriority] = useState(goal?.priority ?? 100)
  const [cap, setCap] = useState(goal?.allocatedAmount ? minorToInput(goal.allocatedAmount, goal.accountCurrency!) : "")
  const [icon, setIcon] = useState(goal?.icon ?? "piggy-bank")
  const [color, setColor] = useState(goal?.color ?? "#10b981")
  const [error, setError] = useState("")
  const savings = accounts.filter((a) => (a.kind === "savings" && !a.archivedAt) || a.id === goal?.accountId)
  const account = accounts.find((a) => a.id === accountId)
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const targetAmount = emergency === "emergency" ? (goal?.targetAmount ?? 1) : parseMoney(target, cur)
    const allocatedAmount = kind === "account" && cap ? parseMoney(cap, account?.currency ?? cur) : null
    if (!targetAmount || (cap && allocatedAmount === null) || (kind === "account" && !accountId)) {
      setError("Укажите сумму цели и накопительный счёт; проверьте лимит распределения.")
      return
    }
    const input = {
      name,
      kind,
      currency: cur as Currency,
      targetAmount,
      targetDate: date,
      accountId: kind === "account" ? accountId : null,
      allocatedAmount,
      expenseMonths: emergency === "emergency" ? months : null,
      expenseWindow: window,
      priority,
      icon,
      color,
    }
    if (goal)
      run(() => updateGoalAction(goal.id, { ...input, currency: cur as Currency, version: goal.version }), {
        success: "Цель сохранена",
        onSuccess: onClose,
      })
    else
      run(() => createGoalAction({ ...input, currency: cur as Currency }), {
        success: "Цель создана",
        onSuccess: ({ id }) => {
          onClose()
          router.push(`/goals/${id}`)
        },
      })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid grid-cols-1 gap-4">
          <DialogHeader>
            <DialogTitle>{goal ? "Изменить цель" : "Новая цель"}</DialogTitle>
            <DialogDescription>Накопления семьи с понятным сроком и планом пополнений.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="goal-name">Название</FieldLabel>
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={60}
              placeholder="Отпуск в Турции"
            />
          </Field>
          <Segmented
            aria-label="Способ накопления"
            value={kind}
            onChange={setKind}
            disabled={!!goal}
            options={[
              { value: "account", label: "На счёте" },
              { value: "manual", label: "Вручную" },
            ]}
          />
          {kind === "account" ? (
            <Field>
              <FieldLabel htmlFor="goal-account">Накопительный счёт</FieldLabel>
              <AccountSelect
                id="goal-account"
                value={accountId}
                accounts={savings}
                onChange={(id) => {
                  setAccountId(id)
                  setCap("")
                }}
                disabled={!!goal}
              />
              {savings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Сначала создайте накопительный счёт.{" "}
                  <LinkButton href="/accounts" variant="link" size="sm">
                    Счета
                  </LinkButton>
                </p>
              ) : null}
            </Field>
          ) : (
            <p className="text-xs text-muted-foreground">Ручные взносы не изменяют баланс счетов и доходы семьи.</p>
          )}
          <Segmented
            aria-label="Тип цели"
            value={emergency}
            onChange={setEmergency}
            options={[
              { value: "fixed", label: "Сумма" },
              { value: "emergency", label: "Подушка" },
            ]}
          />
          <Field>
            <FieldLabel htmlFor="goal-currency">Валюта цели</FieldLabel>
            <CurrencySelect
              id="goal-currency"
              value={cur}
              onChange={(c) => {
                setCur(c)
                setTarget("")
              }}
              disabled={!!goal}
            />
          </Field>
          {emergency === "fixed" ? (
            <Field>
              <FieldLabel htmlFor="goal-target">Сумма цели</FieldLabel>
              <MoneyInput id="goal-target" value={target} onChange={setTarget} currency={cur} required />
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="goal-months">Месяцев расходов в подушке</FieldLabel>
                <Input
                  id="goal-months"
                  type="number"
                  min={1}
                  max={60}
                  value={months}
                  onChange={(e) => setMonths(Number(e.target.value))}
                  required
                />
              </Field>
              <Field>
                <FieldLabel>Средние расходы</FieldLabel>
                <Segmented
                  value={String(window)}
                  onChange={(v) => setWindow(v === "6" ? 6 : 3)}
                  options={[
                    { value: "3", label: "За 3 месяца" },
                    { value: "6", label: "За 6 месяцев" },
                  ]}
                />
                <p className="text-xs text-muted-foreground">
                  По подтверждённым расходам за полные календарные месяцы, включая месяцы без расходов. Сумма обновляется автоматически.
                </p>
              </Field>
            </>
          )}
          <Field>
            <FieldLabel htmlFor="goal-date">Срок (необязательно)</FieldLabel>
            <DateField id="goal-date" value={date} today={today} onChange={setDate} clearable />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="goal-priority">Приоритет (1 — первый)</FieldLabel>
              <Input
                id="goal-priority"
                type="number"
                min={1}
                max={1000}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                required
              />
            </Field>
            {kind === "account" ? (
              <Field>
                <FieldLabel htmlFor="goal-cap">Лимит из счёта (необязательно)</FieldLabel>
                <MoneyInput id="goal-cap" value={cap} onChange={setCap} currency={account?.currency ?? cur} />
              </Field>
            ) : null}
          </div>
          {kind === "account" ? (
            <p className="text-xs text-muted-foreground">
              Единственная цель без лимита получает весь баланс. Общий счёт распределяется по приоритету: сначала до суммы первой цели или
              её лимита, затем остаток следующей. При равном приоритете порядок фиксирован. Перевод увеличивает общий остаток счёта.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="goal-icon">Значок</FieldLabel>
              <Select
                value={icon}
                onValueChange={(v) => v && setIcon(v)}
                items={Object.entries(GOAL_ICONS).map(([value, label]) => ({ value, label }))}
              >
                <SelectTrigger id="goal-icon" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GOAL_ICONS).map(([value, label]) => {
                    const Icon = CATEGORY_ICONS[value]!
                    return (
                      <SelectItem key={value} value={value}>
                        <Icon className="size-4" />
                        <span>{label}</span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="goal-color">Цвет</FieldLabel>
              <Input id="goal-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </Field>
          </div>
          {goal ? (
            <p className="text-xs text-muted-foreground">
              Изменение цели не меняет уже настроенное расписание. Его можно отключить и настроить заново.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={pending}>
              {goal ? "Сохранить" : "Создать цель"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
