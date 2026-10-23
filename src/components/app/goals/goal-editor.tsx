"use client"

import { useTranslations, useLocale } from "next-intl"

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
  const t = useTranslations("goals")
  const items = accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))
  return (
    <Select value={value || null} onValueChange={(v) => v && onChange(v)} items={items} disabled={disabled}>
      <SelectTrigger id={id} className="w-full min-w-0">
        <SelectValue placeholder={t("form.selectAccount")} />
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
  const t = useTranslations("goals")
  const locale = useLocale()
  const GOAL_ICONS = {
    "piggy-bank": t("icons.savings"),
    plane: t("icons.holiday"),
    car: t("icons.car"),
    home: t("icons.home"),
    wrench: t("icons.repairs"),
    "graduation-cap": t("icons.education"),
    "heart-pulse": t("icons.health"),
    gift: t("icons.gift"),
    circle: t("icons.other"),
  }

  const router = useRouter()
  const { pending, run } = useAction()
  const [name, setName] = useState(goal?.name ?? "")
  const [kind, setKind] = useState<"account" | "manual">(goal?.kind ?? "account")
  const [cur, setCur] = useState(goal?.currency ?? currency)
  const [target, setTarget] = useState(goal ? minorToInput(goal.targetAmount, goal.currency, locale) : "")
  const [date, setDate] = useState<string | null>(goal?.targetDate ?? null)
  const [accountId, setAccountId] = useState(goal?.accountId ?? "")
  const [emergency, setEmergency] = useState(goal?.expenseMonths ? "emergency" : "fixed")
  const [months, setMonths] = useState(goal?.expenseMonths ?? 6)
  const [window, setWindow] = useState<3 | 6>(goal?.expenseWindow === 6 ? 6 : 3)
  const [priority, setPriority] = useState(goal?.priority ?? 100)
  const [cap, setCap] = useState(goal?.allocatedAmount ? minorToInput(goal.allocatedAmount, goal.accountCurrency!, locale) : "")
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
      setError(t("form.invalid"))
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
        success: t("form.saved"),
        onSuccess: onClose,
      })
    else
      run(() => createGoalAction({ ...input, currency: cur as Currency }), {
        success: t("form.created"),
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
            <DialogTitle>{goal ? t("form.edit") : t("form.new")}</DialogTitle>
            <DialogDescription>{t("form.description")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="goal-name">{t("form.name")}</FieldLabel>
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={60}
              placeholder={t("form.placeholder")}
            />
          </Field>
          <Segmented
            aria-label={t("form.method")}
            value={kind}
            onChange={setKind}
            disabled={!!goal}
            options={[
              { value: "account", label: t("form.account") },
              { value: "manual", label: t("form.manual") },
            ]}
          />
          {kind === "account" ? (
            <Field>
              <FieldLabel htmlFor="goal-account">{t("form.savingsAccount")}</FieldLabel>
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
                  {t("form.createAccountHint")}{" "}
                  <LinkButton href="/accounts" variant="link" size="sm">
                    {t("form.accounts")}
                  </LinkButton>
                </p>
              ) : null}
            </Field>
          ) : (
            <p className="text-xs text-muted-foreground">{t("form.manualHint")}</p>
          )}
          <Segmented
            aria-label={t("form.kind")}
            value={emergency}
            onChange={setEmergency}
            options={[
              { value: "fixed", label: t("form.amount") },
              { value: "emergency", label: t("form.emergency") },
            ]}
          />
          <Field>
            <FieldLabel htmlFor="goal-currency">{t("form.currency")}</FieldLabel>
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
              <FieldLabel htmlFor="goal-target">{t("form.target")}</FieldLabel>
              <MoneyInput id="goal-target" value={target} onChange={setTarget} currency={cur} required />
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel htmlFor="goal-months">{t("form.expenseMonths")}</FieldLabel>
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
                <FieldLabel>{t("form.averageExpenses")}</FieldLabel>
                <Segmented
                  value={String(window)}
                  onChange={(v) => setWindow(v === "6" ? 6 : 3)}
                  options={[
                    { value: "3", label: t("form.threeMonths") },
                    { value: "6", label: t("form.sixMonths") },
                  ]}
                />
                <p className="text-xs text-muted-foreground">{t("form.expensesHint")}</p>
              </Field>
            </>
          )}
          <Field>
            <FieldLabel htmlFor="goal-date">{t("form.deadline")}</FieldLabel>
            <DateField id="goal-date" value={date} today={today} onChange={setDate} clearable />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="goal-priority">{t("form.priority")}</FieldLabel>
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
                <FieldLabel htmlFor="goal-cap">{t("form.cap")}</FieldLabel>
                <MoneyInput id="goal-cap" value={cap} onChange={setCap} currency={account?.currency ?? cur} />
              </Field>
            ) : null}
          </div>
          {kind === "account" ? <p className="text-xs text-muted-foreground">{t("form.allocationHint")}</p> : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="goal-icon">{t("form.icon")}</FieldLabel>
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
              <FieldLabel htmlFor="goal-color">{t("form.color")}</FieldLabel>
              <Input id="goal-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </Field>
          </div>
          {goal ? <p className="text-xs text-muted-foreground">{t("form.scheduleHint")}</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("actions.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {goal ? t("actions.save") : t("view.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
