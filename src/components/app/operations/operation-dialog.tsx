"use client"

import { Plus, Repeat, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { quoteConversionAction } from "@/app/actions/exchange-rates"
import { formatExchangeRate, formatQuotedRate, formatRateSource } from "@/lib/fx-display"
import type { ExchangeRate } from "@/lib/exchange-rates"
import type { CatalogAccount } from "./catalog-context"
import { createRulesAction, createTransactionAction, updateRuleAction, updateTransactionAction } from "@/app/actions/finance"
import { CategoryIcon } from "@/components/app/category-icon"
import { DateField } from "@/components/app/date-field"
import { MoneyInput } from "@/components/app/money-input"
import { Segmented } from "@/components/app/segmented"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useAction } from "@/hooks/use-action"
import { describeSchedule } from "@/domain/recurrence"
import { formatDateFull, type IsoDate } from "@/lib/dates"
import { minorToInput, parseMoney } from "@/lib/money"
import { useCatalog } from "./catalog-context"
import { FREQUENCY_LABELS, type OperationRow, type OperationType, type RuleRow } from "./types"

export type OperationDialogMode =
  | { kind: "create"; type?: OperationType; date?: IsoDate }
  | { kind: "transaction"; row: OperationRow; rule: RuleRow | null }
  | { kind: "rule"; rule: RuleRow }

type Frequency = keyof typeof FREQUENCY_LABELS

interface FormState {
  type: OperationType
  amount: string
  toAmount: string | null
  categoryId: string | null
  accountId: string | null
  toAccountId: string | null
  date: IsoDate
  title: string
  description: string
  posted: boolean
  repeat: boolean
  frequency: Frequency
  interval: string
  dayOfMonth: string
  extra: { dayOfMonth: string; amount: string }[]
  endDate: IsoDate | null
  scope: "one" | "future"
}

function initialState(mode: OperationDialogMode, today: IsoDate, defaultAccount: string | null, accounts: CatalogAccount[]): FormState {
  const base: FormState = {
    type: "expense",
    amount: "",
    toAmount: null,
    categoryId: null,
    accountId: defaultAccount,
    toAccountId: null,
    date: today,
    title: "",
    description: "",
    posted: true,
    repeat: false,
    frequency: "monthly",
    interval: "1",
    dayOfMonth: String(Number(today.slice(8, 10))),
    extra: [],
    endDate: null,
    scope: "one",
  }
  if (mode.kind === "create") {
    const date = mode.date ?? today
    return { ...base, type: mode.type ?? "expense", date, posted: date <= today, dayOfMonth: String(Number(date.slice(8, 10))) }
  }
  if (mode.kind === "transaction") {
    const r = mode.row
    return {
      ...base,
      type: r.type,
      amount: minorToInput(r.amount, accounts.find((a) => a.id === r.accountId)!.currency),
      toAmount: r.toAmount ? minorToInput(r.toAmount, accounts.find((a) => a.id === r.toAccountId)!.currency) : null,
      categoryId: r.categoryId,
      accountId: r.accountId,
      toAccountId: r.toAccountId,
      date: r.date,
      title: r.title,
      description: r.description ?? "",
      posted: r.status === "posted",
    }
  }
  const rule = mode.rule
  return {
    ...base,
    type: rule.type,
    amount: minorToInput(rule.amount, accounts.find((a) => a.id === rule.accountId)!.currency),
    toAmount: rule.toAmount ? minorToInput(rule.toAmount, accounts.find((a) => a.id === rule.toAccountId)!.currency) : null,
    categoryId: rule.categoryId,
    accountId: rule.accountId,
    toAccountId: rule.toAccountId,
    date: rule.startDate,
    title: rule.title,
    description: rule.description ?? "",
    posted: false,
    repeat: true,
    frequency: rule.frequency === "once" ? "monthly" : rule.frequency,
    interval: String(rule.interval),
    dayOfMonth: String(rule.dayOfMonth ?? Number(rule.startDate.slice(8, 10))),
    endDate: rule.endDate,
  }
}

export function OperationDialog({ mode, open, onOpenChange }: { mode: OperationDialogMode; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        {/* Remount the form for each opened operation so its state is fresh. */}
        {open ? <OperationForm key={JSON.stringify(mode)} mode={mode} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function OperationForm({ mode, onDone }: { mode: OperationDialogMode; onDone: () => void }) {
  const { categories, accounts, today } = useCatalog()
  const activeAccounts = accounts.filter((a) => !a.archived)
  const [s, setS] = useState<FormState>(() => initialState(mode, today, activeAccounts[0]?.id ?? null, accounts))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const { pending, run } = useAction()
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setS((prev) => ({ ...prev, [key]: value }))

  const currency = accounts.find((a) => a.id === s.accountId)?.currency ?? "RUB"
  const toCurrency = accounts.find((a) => a.id === s.toAccountId)?.currency ?? currency
  const crossCurrency = s.type === "transfer" && currency !== toCurrency
  const parsedAmount = parseMoney(s.amount, currency)
  const quoteDate = s.posted && !s.repeat && mode.kind !== "rule" && s.scope !== "future" ? s.date : today
  const quoteKey = `${parsedAmount}:${currency}:${toCurrency}:${quoteDate}`
  const [quote, setQuote] = useState<{ key: string; amount: number | null; warnings: string[]; rates: ExchangeRate[] } | null>(null)
  useEffect(() => {
    if (!crossCurrency || !parsedAmount) return
    let active = true
    const timer = setTimeout(() => {
      void quoteConversionAction(parsedAmount, currency, toCurrency, quoteDate).then((res) => {
        if (active && res.ok) setQuote({ key: quoteKey, ...res.data })
      })
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [parsedAmount, currency, toCurrency, quoteDate, quoteKey, crossCurrency])
  const currentQuote = quote?.key === quoteKey ? quote : null
  const creditedInput = s.toAmount ?? (currentQuote?.amount ? minorToInput(currentQuote.amount, toCurrency) : "")
  const credited = crossCurrency ? parseMoney(creditedInput, toCurrency) : null
  const effectiveRate = parsedAmount && credited ? formatExchangeRate(parsedAmount, credited, currency, toCurrency) : null
  const referenceRate = currentQuote?.amount ? formatQuotedRate(currentQuote.rates, currency, toCurrency) : null
  const rateSource = currentQuote ? formatRateSource(currentQuote.rates) : null

  const isRule = mode.kind === "rule"
  const isOccurrence = mode.kind === "transaction" && mode.row.recurringRuleId !== null
  const editingFuture = isOccurrence && s.scope === "future"
  const showSchedule = (mode.kind === "create" && s.repeat) || isRule
  const typeLocked = mode.kind !== "create"

  const kindCategories = categories.filter((c) => s.type !== "transfer" && c.kind === s.type && (!c.archived || c.id === s.categoryId))
  const selectableAccounts = accounts.filter((a) => !a.archived || a.id === s.accountId || a.id === s.toAccountId)
  const category = categories.find((c) => c.id === s.categoryId)

  const title =
    mode.kind === "create" ? "Новая операция" : mode.kind === "rule" ? "Регулярная операция" : isOccurrence ? "Операция из расписания" : "Операция"

  function changeType(type: OperationType) {
    setS((prev) => ({ ...prev, type, categoryId: null, toAccountId: null }))
  }

  function changeDate(date: IsoDate | null) {
    if (!date) return
    setS((prev) => ({
      ...prev,
      date,
      // A future date usually means the operation has not happened yet.
      posted: mode.kind === "create" ? date <= today : prev.posted,
      dayOfMonth: mode.kind === "create" ? String(Number(date.slice(8, 10))) : prev.dayOfMonth,
    }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseMoney(s.amount, currency)
    const fieldErrors: Record<string, string> = {}
    if (crossCurrency && !credited) fieldErrors.toAmount = "Укажите сумму зачисления"
    if (!amount) fieldErrors.amount = "Укажите сумму"
    if (s.type !== "transfer" && !s.categoryId) fieldErrors.categoryId = "Выберите категорию"
    if (!s.accountId) fieldErrors.accountId = "Выберите счёт"
    if (s.type === "transfer" && !s.toAccountId) fieldErrors.toAccountId = "Выберите счёт зачисления"
    const extra = s.extra.map((x) => ({ dayOfMonth: Number(x.dayOfMonth), amount: parseMoney(x.amount, currency) ?? 0 }))
    if (showSchedule && extra.some((x) => !x.amount || !(x.dayOfMonth >= 1 && x.dayOfMonth <= 31))) fieldErrors.extra = "Проверьте дополнительные начисления"
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length > 0 || !amount || !s.accountId) return

    const fields = {
      type: s.type,
      amount,
      toAmount: crossCurrency ? credited : null,
      title: s.title.trim(),
      description: s.description.trim() || null,
      categoryId: s.type === "transfer" ? null : s.categoryId,
      accountId: s.accountId,
      toAccountId: s.type === "transfer" ? s.toAccountId : null,
    }
    const schedule = {
      frequency: s.frequency,
      interval: Math.max(1, Number(s.interval) || 1),
      dayOfMonth: s.frequency === "monthly" || s.frequency === "yearly" ? Number(s.dayOfMonth) || null : null,
      startDate: s.date,
      endDate: s.endDate,
    }
    const onError = (_: string, fe?: Record<string, string>) => fe && setErrors(fe)

    if (mode.kind === "create" && s.repeat) {
      run(() => createRulesAction({ rule: { ...fields, ...schedule }, extra: s.frequency === "monthly" ? extra : [] }), {
        success: "Регулярная операция создана",
        onSuccess: onDone,
        onError,
      })
    } else if (mode.kind === "create") {
      run(() => createTransactionAction({ ...fields, date: s.date, status: s.posted ? "posted" : "planned" }), {
        success: "Операция добавлена",
        onSuccess: onDone,
        onError,
      })
    } else if (mode.kind === "rule") {
      run(() => updateRuleAction(mode.rule.id, { rule: { ...fields, ...schedule }, version: mode.rule.version }), {
        success: "Расписание обновлено",
        onSuccess: onDone,
        onError,
      })
    } else if (editingFuture && mode.rule) {
      const r = mode.rule
      run(
        () =>
          updateRuleAction(r.id, {
            rule: { ...fields, frequency: r.frequency, interval: r.interval, dayOfMonth: r.dayOfMonth, startDate: r.startDate, endDate: r.endDate },
            version: r.version,
            effectiveFrom: mode.row.occurrenceDate ?? mode.row.date,
          }),
        { success: "Изменения применены ко всем следующим операциям", onSuccess: onDone, onError },
      )
    } else if (mode.kind === "transaction") {
      run(
        () => updateTransactionAction(mode.row.id, { ...fields, date: s.date, status: s.posted ? "posted" : "planned", version: mode.row.version }),
        { success: "Операция сохранена", onSuccess: onDone, onError },
      )
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {isRule ? (
          <DialogDescription>Изменения применятся к будущим неподтверждённым операциям, начиная с сегодняшнего дня.</DialogDescription>
        ) : isOccurrence && mode.kind === "transaction" ? (
          <DialogDescription>
            Плановая дата по расписанию: {formatDateFull(mode.row.occurrenceDate ?? mode.row.date)}
          </DialogDescription>
        ) : null}
      </DialogHeader>

      {isOccurrence ? (
        <Segmented
          value={s.scope}
          onChange={(v) => set("scope", v)}
          size="sm"
          options={[
            { value: "one", label: "Только эту" },
            { value: "future", label: "Эту и все следующие" },
          ]}
        />
      ) : null}

      {!typeLocked ? (
        <Segmented
          value={s.type}
          onChange={changeType}
          options={[
            { value: "expense", label: "Расход" },
            { value: "income", label: "Доход" },
            { value: "transfer", label: "Перевод" },
          ]}
        />
      ) : null}

      <Field>
        <FieldLabel htmlFor="op-amount">Сумма</FieldLabel>
        <MoneyInput
          currency={currency}
          id="op-amount"
          autoFocus={mode.kind === "create"}
          value={s.amount}
          onChange={(v) => setS((prev) => ({ ...prev, amount: v, toAmount: null }))}
          aria-invalid={Boolean(errors.amount)}
          className="[&_input]:h-11 [&_input]:text-lg"
        />
        {errors.amount ? <p className="text-sm text-destructive">{errors.amount}</p> : null}
      </Field>

      {s.type !== "transfer" ? (
        <Field>
          <FieldLabel>Категория</FieldLabel>
          <Select
            value={s.categoryId}
            onValueChange={(v) => set("categoryId", v as string | null)}
            items={kindCategories.map((c) => ({ value: c.id, label: c.name }))}
          >
            <SelectTrigger className="w-full" aria-invalid={Boolean(errors.categoryId)}>
              <SelectValue placeholder="Выберите категорию">
                {category ? (
                  <span className="flex items-center gap-2">
                    <CategoryIcon icon={category.icon} color={category.color} className="size-5 rounded-md [&_svg]:size-3" />
                    {category.name}
                  </span>
                ) : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {kindCategories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <CategoryIcon icon={c.icon} color={c.color} className="size-5 rounded-md [&_svg]:size-3" />
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.categoryId ? <p className="text-sm text-destructive">{errors.categoryId}</p> : null}
        </Field>
      ) : null}

      <div className={s.type === "transfer" ? "grid grid-cols-1 gap-4 sm:grid-cols-2" : "grid grid-cols-1 gap-4"}>
        <Field>
          <FieldLabel>{s.type === "transfer" ? "Со счёта" : "Счёт"}</FieldLabel>
          <AccountSelect value={s.accountId} onChange={(v) => setS((prev) => ({ ...prev, accountId: v, toAmount: null }))} accounts={selectableAccounts} invalid={Boolean(errors.accountId)} />
        </Field>
        {s.type === "transfer" ? (
          <Field>
            <FieldLabel>На счёт</FieldLabel>
            <AccountSelect
              value={s.toAccountId}
              onChange={(v) => setS((prev) => ({ ...prev, toAccountId: v, toAmount: null }))}
              accounts={selectableAccounts.filter((a) => a.id !== s.accountId)}
              invalid={Boolean(errors.toAccountId)}
            />
          </Field>
        ) : null}
      </div>

      {crossCurrency ? <Field>
        <FieldLabel htmlFor="op-to-amount">Зачислено</FieldLabel>
        <MoneyInput id="op-to-amount" currency={toCurrency} value={creditedInput} onChange={(v) => set("toAmount", v)} aria-invalid={Boolean(errors.toAmount)} />
        {referenceRate ? <p className="text-xs text-muted-foreground">{referenceRate}{rateSource ? ` · ${rateSource}` : ""}</p> : null}
        {effectiveRate && (!referenceRate || effectiveRate !== referenceRate) ? <p className="text-xs text-muted-foreground">{effectiveRate} · по суммам перевода</p> : null}
        {currentQuote?.warnings.map((warning) => <p key={warning} className="text-xs text-muted-foreground">{warning}</p>)}
        {errors.toAmount ? <p className="text-sm text-destructive">{errors.toAmount}</p> : null}
      </Field> : null}

      {!editingFuture ? (
        <Field>
          <FieldLabel>{showSchedule ? "Дата начала" : "Дата"}</FieldLabel>
          <DateField value={s.date} onChange={changeDate} today={today} />
        </Field>
      ) : null}

      <Field>
        <FieldLabel htmlFor="op-title">Название</FieldLabel>
        <Input
          id="op-title"
          value={s.title}
          maxLength={120}
          onChange={(e) => set("title", e.target.value)}
          placeholder={category?.name ?? (s.type === "transfer" ? "Перевод" : "Например, «Продукты на неделю»")}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="op-desc">Описание</FieldLabel>
        <Textarea id="op-desc" value={s.description} maxLength={1000} rows={2} onChange={(e) => set("description", e.target.value)} placeholder="Необязательно" />
      </Field>

      {mode.kind === "create" ? (
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Repeat className="size-4 text-muted-foreground" /> Повторять регулярно
          </span>
          <Switch checked={s.repeat} onCheckedChange={(v) => set("repeat", v)} />
        </label>
      ) : null}

      {showSchedule ? <ScheduleFields s={s} set={set} errors={errors} today={today} allowExtra={mode.kind === "create" && !crossCurrency} currency={currency} /> : null}

      {!showSchedule && !editingFuture ? (
        <label className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <span className="text-sm">
            <span className="font-medium">Уже выполнена</span>
            <span className="block text-muted-foreground">
              {s.posted ? "Учитывается в фактическом балансе" : "Запланирована: учитывается только в прогнозе"}
            </span>
          </span>
          <Switch checked={s.posted} onCheckedChange={(v) => set("posted", v)} />
        </label>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Отмена
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Сохранение…" : mode.kind === "create" ? "Добавить" : "Сохранить"}
        </Button>
      </DialogFooter>
    </form>
  )
}

function AccountSelect({
  value,
  onChange,
  accounts,
  invalid,
}: {
  value: string | null
  onChange: (value: string | null) => void
  accounts: { id: string; name: string; currency: string }[]
  invalid?: boolean
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as string | null)} items={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}>
      <SelectTrigger className="w-full" aria-invalid={invalid}>
        <SelectValue placeholder="Выберите счёт" />
      </SelectTrigger>
      <SelectContent>
        {accounts.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.name} · {a.currency}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ScheduleFields({
  s,
  set,
  errors,
  today,
  allowExtra,
  currency,
}: {
  s: FormState
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void
  errors: Record<string, string>
  today: IsoDate
  allowExtra: boolean
  currency: string
}) {
  const monthly = s.frequency === "monthly"
  const dayBased = monthly || s.frequency === "yearly"
  const summary = describeSchedule({
    frequency: s.frequency,
    interval: Math.max(1, Number(s.interval) || 1),
    dayOfMonth: dayBased ? Number(s.dayOfMonth) || null : null,
    startDate: s.date,
  })
  return (
    <div className="grid grid-cols-1 gap-4 rounded-lg border bg-muted/30 p-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
        <Field>
          <FieldLabel>Периодичность</FieldLabel>
          <Select
            value={s.frequency}
            onValueChange={(v) => v && set("frequency", v as Frequency)}
            items={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="op-interval">Каждые</FieldLabel>
          <Input
            id="op-interval"
            type="number"
            min={1}
            max={366}
            className="sm:w-20"
            value={s.interval}
            onChange={(e) => set("interval", e.target.value)}
          />
        </Field>
      </div>

      {dayBased ? (
        <Field>
          <FieldLabel htmlFor="op-day">День месяца</FieldLabel>
          <Input id="op-day" type="number" min={1} max={31} value={s.dayOfMonth} onChange={(e) => set("dayOfMonth", e.target.value)} />
          <p className="text-xs text-muted-foreground">Если в месяце меньше дней — в последний день месяца.</p>
        </Field>
      ) : null}

      {monthly && allowExtra ? (
        <div className="grid grid-cols-1 gap-2">
          {s.extra.map((x, i) => (
            <div key={i} className="grid grid-cols-[5rem_1fr_auto] items-end gap-2">
              <Field>
                <Label className="text-xs">День</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={x.dayOfMonth}
                  onChange={(e) => set("extra", s.extra.map((y, j) => (j === i ? { ...y, dayOfMonth: e.target.value } : y)))}
                />
              </Field>
              <Field>
                <Label className="text-xs">Сумма</Label>
                <MoneyInput currency={currency} value={x.amount} onChange={(v) => set("extra", s.extra.map((y, j) => (j === i ? { ...y, amount: v } : y)))} />
              </Field>
              <Button type="button" variant="ghost" size="icon" aria-label="Удалить начисление" onClick={() => set("extra", s.extra.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          {errors.extra ? <p className="text-sm text-destructive">{errors.extra}</p> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => set("extra", [...s.extra, { dayOfMonth: "20", amount: "" }])}
          >
            <Plus /> Ещё начисление в месяце
          </Button>
          {s.extra.length > 0 ? (
            <p className="text-xs text-muted-foreground">Например, аванс 20-го и зарплата 5-го — с разными суммами.</p>
          ) : null}
        </div>
      ) : null}

      <Field>
        <FieldLabel>Дата окончания</FieldLabel>
        <DateField value={s.endDate} onChange={(v) => set("endDate", v)} today={today} placeholder="Бессрочно" quick={false} clearable />
      </Field>

      <p className="text-sm text-muted-foreground">
        {summary}
        {s.endDate ? `, до ${formatDateFull(s.endDate)}` : ""}. Операции создаются как запланированные — подтвердите их, когда они фактически
        произойдут.
      </p>
    </div>
  )
}
