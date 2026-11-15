"use client"

import { useTranslations, useLocale } from "next-intl"

import { LocalizedError, errorMessage } from "@/i18n/errors"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Line, LineChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts"
import { addLoanEventAction, cancelLoanEventAction, closeLoanAction, deleteLoanAction } from "@/app/actions/loans"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { DateField } from "@/components/app/date-field"
import { MoneyInput } from "@/components/app/money-input"
import { useCatalog } from "@/components/app/operations/catalog-context"
import { Segmented } from "@/components/app/segmented"
import { Badge } from "@/components/ui/badge"
import { ChartContainer } from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { calculateLoanSchedule, toLoanEventInput, type LoanTermsSnapshot, type PrepaymentMode } from "@/domain/loan"
import { useAction } from "@/hooks/use-action"
import { addDays, formatDateFull, formatMonth } from "@/lib/dates"
import { formatMoney, formatMoneyCompact, minorToInput, parseMoney } from "@/lib/money"
import { HolidayEndForm, HolidayForm, LoanEditForm, RestructuringForm, type LoanDetailData as Detail } from "./loan-changes"
import { LoanSchedule } from "./loan-schedule"

type LedgerEventType = "prepayment" | "rate_change" | "reconciliation"
type ChangeForm = "edit" | "restructuring" | "holiday" | { holidayEnd: string }

export function LoanDetail({ data: d, today, canManage }: { data: Detail; today: string; canManage: boolean }) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const [eventType, setEventType] = useState<LedgerEventType | null>(null)
  const [change, setChange] = useState<ChangeForm | null>(null)
  const { run } = useAction()
  const router = useRouter()
  const active = d.loan.status === "active"
  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t("summary.balance")} value={formatMoney(d.debt, d.currency, { locale })} />
        <Stat
          label={t("summary.nextPayment")}
          value={d.next ? formatMoney(d.next.payment, d.currency, { locale }) : t("summary.none")}
          note={d.next ? formatDateFull(d.next.date, locale) : undefined}
        />
        <Stat
          label={t("summary.totalInterest")}
          value={formatMoney(d.paidInterest + d.futureInterest, d.currency, { locale })}
          note={t("detail.paidInterest", { amount: formatMoney(d.paidInterest, d.currency, { locale }) })}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {t("detail.terms", {
          lender: d.loan.lender,
          rate: Number(d.terms.annualRate).toLocaleString(locale, { maximumFractionDigits: 6 }),
          payoff: d.payoffDate ? formatDateFull(d.payoffDate, locale) : "—",
          status: d.loan.status,
          trackingDate: formatDateFull(d.loan.trackingDate, locale),
        })}
      </p>
      {active && canManage ? (
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap [&_button]:px-2 sm:[&_button]:px-3">
          <Button onClick={() => setEventType("prepayment")}>{t("detail.prepay")}</Button>
          <Button variant="outline" onClick={() => setChange("edit")}>
            {t("detail.edit")}
          </Button>
          <Button variant="outline" onClick={() => setChange("restructuring")}>
            {t("detail.restructure")}
          </Button>
          <Button variant="outline" onClick={() => setChange("holiday")}>
            {t("detail.holiday")}
          </Button>
          <Button variant="outline" onClick={() => setEventType("rate_change")}>
            {t("detail.changeRate")}
          </Button>
          <Button variant="outline" onClick={() => setEventType("reconciliation")}>
            {t("detail.reconcile")}
          </Button>
          <CloseLoanDialog data={d} today={today} />
        </div>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("detail.balanceChart")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="h-64 min-w-0 w-full">
            <ChartContainer
              config={{ balance: { label: t("detail.principal"), color: "var(--chart-1)" } }}
              className="aspect-auto h-64 w-full"
            >
              <LineChart
                data={[{ date: d.loan.trackingDate, balance: d.loan.trackingBalance }, ...d.rows]}
                margin={{ left: 0, right: 10, top: 10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tickFormatter={(date) => formatMonth(String(date), locale)} minTickGap={60} fontSize={11} />
                <YAxis width={80} tickFormatter={(v: number) => formatMoneyCompact(v, d.currency, locale)} fontSize={11} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8 }}
                  formatter={(v) => formatMoney(Number(v), d.currency, { locale })}
                  labelFormatter={(v) => formatDateFull(String(v), locale)}
                />
                <Line
                  dataKey="balance"
                  name={t("detail.debt")}
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          </div>
        </CardContent>
      </Card>
      {active ? <PrepaymentSimulator data={d} today={today} /> : null}
      {d.events.length ? <LoanEvents data={d} today={today} canManage={canManage && active} onChangeHoliday={setChange} /> : null}
      <section className="min-w-0">
        <h2 className="mb-3 text-lg font-semibold">{t("detail.schedule")}</h2>
        <LoanSchedule rows={d.rows} currency={d.currency} today={today} loanId={d.loan.id} closed={!active} />
      </section>
      {canManage ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline" className="justify-self-start text-destructive">
              {t("detail.delete")}
            </Button>
          }
          title={t("detail.deleteTitle")}
          description={t("detail.deleteDescription")}
          onConfirm={() =>
            run(() => deleteLoanAction(d.loan.id, d.loan.version), { success: t("detail.deleted"), onSuccess: () => router.push("/loans") })
          }
        />
      ) : null}
      <Dialog open={eventType !== null} onOpenChange={(o) => !o && setEventType(null)}>
        <DialogContent>
          {eventType ? <EventForm key={eventType} type={eventType} data={d} today={today} onClose={() => setEventType(null)} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={change !== null} onOpenChange={(o) => !o && setChange(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {change === "edit" ? <LoanEditForm data={d} today={today} onClose={() => setChange(null)} /> : null}
          {change === "restructuring" ? <RestructuringForm data={d} today={today} onClose={() => setChange(null)} /> : null}
          {change === "holiday" ? <HolidayForm data={d} today={today} onClose={() => setChange(null)} /> : null}
          {typeof change === "object" && change ? (
            <HolidayEndForm data={d} eventId={change.holidayEnd} today={today} onClose={() => setChange(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CloseLoanDialog({ data: d, today }: { data: Detail; today: string }) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const accounts = useCatalog().accounts.filter((a) => !a.archived && a.kind !== "loan" && a.currency === d.currency)
  const defaultAccount = accounts.find((a) => a.id === d.loan.paymentAccountId)?.id ?? accounts[0]?.id ?? ""
  const { interest: due, interestTotal, principal } = d.remaining
  const single = due.length === 1
  const computedAmount = single ? minorToInput(due[0]!.amount, d.currency, locale) : ""
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"pay" | "waive">("pay")
  const [date, setDate] = useState(today)
  const [accountId, setAccountId] = useState(defaultAccount)
  const [amount, setAmount] = useState(computedAmount)
  const { pending, run } = useAction()
  const money = (value: number) => formatMoney(value, d.currency, { locale })
  const paidAmount = single ? parseMoney(amount, d.currency) : undefined
  const canPay = Boolean(accountId) && paidAmount !== null && paidAmount !== 0
  function show() {
    setMode("pay")
    setDate(today)
    setAccountId(defaultAccount)
    setAmount(computedAmount)
    setOpen(true)
  }
  function submit() {
    const interest = !due.length
      ? undefined
      : mode === "waive"
        ? { mode: "waive" as const }
        : { mode: "pay" as const, date, accountId, ...(single ? { amount: paidAmount! } : {}) }
    const success = !interest ? t("detail.closed") : interest.mode === "pay" ? t("close.paidClosed") : t("close.waivedClosed")
    run(() => closeLoanAction(d.loan.id, { version: d.loan.version, interest }), { success, onSuccess: () => setOpen(false) })
  }
  const choices = [
    { value: "pay" as const, label: t("close.payChoice"), description: t("close.payDescription") },
    { value: "waive" as const, label: t("close.waiveChoice"), description: t("close.waiveDescription") },
  ]
  return (
    <>
      <Button variant="outline" onClick={show} disabled={pending}>
        {t("detail.close")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("detail.closeTitle")}</DialogTitle>
            <DialogDescription>{t("detail.closeDescription")}</DialogDescription>
          </DialogHeader>
          {principal !== 0 ? (
            <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm">
              {t("close.principalRemaining", { amount: money(principal) })}
            </p>
          ) : due.length ? (
            <div className="grid min-w-0 gap-4">
              <div className="rounded-lg border p-3">
                <p className="font-medium">{t("close.interestTotal", { amount: money(interestTotal) })}</p>
                <ul className="mt-2 grid min-w-0 gap-2 text-sm">
                  {due.map((item) => (
                    <li key={item.date} className="min-w-0 break-words">
                      <span className="font-medium">
                        {formatDateFull(item.date, locale)} · {money(item.amount)}
                      </span>
                      <span className="block text-muted-foreground">
                        {t("close.accrualPeriod", { from: formatDateFull(item.from, locale), to: formatDateFull(item.to, locale) })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <fieldset className="grid min-w-0 gap-2">
                <legend className="mb-2 font-medium">{t("close.chooseAction")}</legend>
                {choices.map((choice) => (
                  <label
                    key={choice.value}
                    className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                  >
                    <input
                      type="radio"
                      name="loan-close-interest"
                      value={choice.value}
                      checked={mode === choice.value}
                      onChange={() => setMode(choice.value)}
                      className="mt-1 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{choice.label}</span>
                      <span className="block text-xs text-muted-foreground">{choice.description}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {mode === "pay" ? (
                <div className="grid min-w-0 gap-4">
                  <Field>
                    <FieldLabel htmlFor="loan-close-date">{t("close.date")}</FieldLabel>
                    <DateField id="loan-close-date" value={date} onChange={(v) => v && setDate(v)} today={today} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="loan-close-account">{t("close.account")}</FieldLabel>
                    <Select
                      value={accountId}
                      onValueChange={(value) => value && setAccountId(value)}
                      items={accounts.map((a) => ({ value: a.id, label: a.name }))}
                    >
                      <SelectTrigger id="loan-close-account" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {single ? (
                    <Field>
                      <FieldLabel htmlFor="loan-close-amount">{t("close.amount")}</FieldLabel>
                      <MoneyInput id="loan-close-amount" currency={d.currency} value={amount} onChange={setAmount} />
                    </Field>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("close.eachComputedAmount")}</p>
                  )}
                </div>
              ) : (
                <p className="rounded-lg bg-muted p-3 text-sm">{t("close.nothingCharged")}</p>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("actions.cancel")}
            </Button>
            {principal === 0 ? (
              <Button type="button" disabled={pending || (due.length > 0 && mode === "pay" && !canPay)} onClick={submit}>
                {!due.length ? t("detail.closeConfirm") : mode === "pay" ? t("close.payAndClose") : t("close.waiveAndClose")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <p className="text-xs text-muted-foreground">{label}</p>
        <CardTitle className="text-xl break-words">{value}</CardTitle>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </CardHeader>
    </Card>
  )
}

function LoanEvents({
  data: d,
  today,
  canManage,
  onChangeHoliday,
}: {
  data: Detail
  today: string
  canManage: boolean
  onChangeHoliday: (form: ChangeForm) => void
}) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const { run } = useAction()
  const money = (value: number | null) => (value === null ? "—" : formatMoney(value, d.currency, { locale }))
  const percent = (value: string | number) => Number(value).toLocaleString(locale, { maximumFractionDigits: 6 })
  const describe = (e: Detail["events"][number]) => {
    if (e.type === "rate_change") return t("event.rateDescription", { rate: percent(e.annualRate!) })
    if (e.type === "reconciliation") return t("event.reconciledDescription", { amount: money(e.balance) })
    if (e.type === "prepayment") return t("event.prepaymentDescription", { amount: money(e.amount), mode: e.mode! })
    if (e.type === "correction") return t("event.correctionDescription")
    if (e.type === "restructuring") return t("event.restructuringDescription")
    return [
      t("event.holidayDescription", { mode: e.holidayMode!, end: formatDateFull(e.endDate!, locale) }),
      ...(e.holidayInterest ? [t(`holiday.interestOption.${e.holidayInterest}`)] : []),
      e.holidayShift === "extend_term" ? t("holiday.shiftExtend") : t("holiday.shiftKeep"),
    ].join(" · ")
  }
  const termsLine = (s: LoanTermsSnapshot) =>
    t("event.termsLine", {
      rate: percent(s.annualRate),
      payment: money(s.nextPayment),
      end: s.endDate ? formatDateFull(s.endDate, locale) : "—",
      balance: money(s.balance),
    })
  const canCancel = (e: Detail["events"][number]) =>
    canManage &&
    !d.events.some((other) => other.id !== e.id && other.date >= e.date) &&
    e.type !== "prepayment" &&
    e.type !== "reconciliation" &&
    !d.posted.some((p) => p.dueDate > e.date)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("detail.events")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-3 text-sm">
          {d.events.map((e) => (
            <li key={e.id} className="grid min-w-0 grid-cols-1 gap-1 break-words">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {formatDateFull(e.date, locale)} · {describe(e)}
                </span>
                {e.date > today ? <Badge variant="outline">{t("event.scheduled")}</Badge> : null}
              </div>
              {e.terms ? (
                <p className="text-xs text-muted-foreground">
                  {t("event.before", { terms: termsLine(e.terms.before) })}
                  <br />
                  {t("event.after", { terms: termsLine(e.terms.after) })}
                </p>
              ) : null}
              {e.note ? <p className="text-xs text-muted-foreground">{e.note}</p> : null}
              {canManage && (canCancel(e) || (e.type === "holiday" && e.endDate! >= today)) ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  {e.type === "holiday" && e.endDate! >= today ? (
                    <Button size="sm" variant="outline" onClick={() => onChangeHoliday({ holidayEnd: e.id })}>
                      {t("holiday.endEdit")}
                    </Button>
                  ) : null}
                  {canCancel(e) ? (
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="outline">
                          {t("event.cancel")}
                        </Button>
                      }
                      title={t("event.cancelTitle")}
                      description={t("event.cancelDescription")}
                      confirmLabel={t("event.cancelConfirm")}
                      destructive={false}
                      onConfirm={() => run(() => cancelLoanEventAction(d.loan.id, d.loan.version, e.id), { success: t("event.cancelled") })}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function EventForm({ type, data: d, today, onClose }: { type: LedgerEventType; data: Detail; today: string; onClose: () => void }) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const modeOptions = [
    { value: "reduce_term" as const, label: t("prepayment.reduce_term") },
    { value: "reduce_payment" as const, label: t("prepayment.reduce_payment") },
  ]

  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState("")
  const [rate, setRate] = useState("")
  const [mode, setMode] = useState<PrepaymentMode>("reduce_term")
  const [payAccruedInterest, setPayAccruedInterest] = useState(true)
  const [error, setError] = useState("")
  const { pending, run } = useAction()
  const title = type === "prepayment" ? t("detail.prepay") : type === "rate_change" ? t("detail.changeRate") : t("detail.reconcile")
  const enteredAmount = parseMoney(amount, d.currency)
  const fullPrepayment = type === "prepayment" && d.debt > 0 && enteredAmount !== null && enteredAmount >= d.debt
  let accruedRows: { date: string; interest: number }[] = []
  if (fullPrepayment) {
    try {
      accruedRows = calculateLoanSchedule(
        d.loan,
        [...d.events.map(toLoanEventInput), { type: "prepayment", date, amount: d.debt, mode }],
        d.posted,
      ).filter((row) => row.kind === "scheduled" && row.date > date && row.interest > 0)
    } catch {
      accruedRows = []
    }
  }
  const accruedInterest = accruedRows.reduce((sum, row) => sum + row.interest, 0)
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = parseMoney(amount, d.currency)
    if (type !== "rate_change" && (value === null || (type === "prepayment" && value === 0))) return setError(t("event.invalidAmount"))
    const event =
      type === "rate_change"
        ? { type, date, annualRate: rate.replace(",", ".") }
          : type === "reconciliation"
            ? { type, date, balance: value! }
            : { type, date, amount: value!, mode, ...(fullPrepayment ? { payAccruedInterest } : {}) }
    run(() => addLoanEventAction(d.loan.id, d.loan.version, event), {
      success: type === "prepayment" && fullPrepayment && payAccruedInterest && accruedInterest > 0 ? t("event.prepaymentInterestUpdated") : t("event.updated"),
      onSuccess: onClose,
      onError: setError,
    })
  }
  return (
    <form className="grid grid-cols-1 gap-4" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {type === "prepayment" ? t("event.prepaymentHint") : type === "reconciliation" ? t("event.reconcileHint") : t("event.rateHint")}
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="loan-event-date">{t("event.date")}</FieldLabel>
        <DateField id="loan-event-date" value={date} onChange={(v) => v && setDate(v)} today={today} />
      </Field>
      {type === "rate_change" ? (
        <Field>
          <FieldLabel htmlFor="loan-event-rate">{t("event.rate")}</FieldLabel>
          <Input id="loan-event-rate" required inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
      ) : (
        <Field>
          <FieldLabel htmlFor="loan-event-amount">
            {type === "reconciliation" ? t("event.principalBalance") : t("event.prepaymentAmount")}
          </FieldLabel>
          <MoneyInput id="loan-event-amount" currency={d.currency} value={amount} onChange={setAmount} />
        </Field>
      )}
      {type === "prepayment" ? <Segmented size="sm" value={mode} onChange={setMode} options={modeOptions} /> : null}
      {fullPrepayment ? (
        <div className="grid min-w-0 gap-2 rounded-lg border p-3">
          <p className="text-sm">{t("event.accruedPrepaymentInterest", { amount: formatMoney(accruedInterest, d.currency, { locale }) })}</p>
          {accruedRows.length ? (
            <ul className="text-xs text-muted-foreground">
              {accruedRows.map((row) => <li key={row.date}>{formatDateFull(row.date, locale)} · {formatMoney(row.interest, d.currency, { locale })}</li>)}
            </ul>
          ) : null}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={payAccruedInterest} onChange={(e) => setPayAccruedInterest(e.target.checked)} className="mt-1" />
            <span>{t("event.payAccruedInterest")}</span>
          </label>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("actions.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {t("actions.save")}
        </Button>
      </DialogFooter>
    </form>
  )
}

function PrepaymentSimulator({ data: d, today }: { data: Detail; today: string }) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const modeOptions = [
    { value: "reduce_term" as const, label: t("prepayment.reduce_term") },
    { value: "reduce_payment" as const, label: t("prepayment.reduce_payment") },
  ]

  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(d.events.at(-1)?.date === today ? addDays(today, 1) : today)
  const value = parseMoney(amount, d.currency)
  const baselineInterest = d.rows.reduce((s, r) => s + r.interest, 0)
  const results = modeOptions.map(({ value: mode, label }) => {
    if (!value) return { mode, label, error: t("simulator.enterAmount") }
    try {
      const rows = calculateLoanSchedule(d.loan, [...d.events.map(toLoanEventInput), { type: "prepayment", date, amount: value, mode }], d.posted)
      const next = rows.find((r) => r.kind === "scheduled" && r.date > date)
      return {
        mode,
        label,
        saving: baselineInterest - rows.reduce((s, r) => s + r.interest, 0),
        payoff: rows.at(-1)?.date,
        next: next?.payment ?? 0,
      }
    } catch (e) {
      return {
        mode,
        label,
        error: e instanceof LocalizedError ? errorMessage(e.messageKey, e.params, locale) : t("simulator.checkParameters"),
      }
    }
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("simulator.title")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        <p className="text-sm text-muted-foreground">{t("simulator.description")}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="loan-sim-amount">{t("simulator.amount")}</FieldLabel>
            <MoneyInput id="loan-sim-amount" currency={d.currency} value={amount} onChange={setAmount} />
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-sim-date">{t("simulator.date")}</FieldLabel>
            <DateField id="loan-sim-date" value={date} onChange={(v) => v && setDate(v)} today={today} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-live="polite">
          {results.map((r) => (
            <div key={r.mode} className="min-w-0 rounded-xl border p-3 text-sm">
              <h3 className="font-medium">{r.label}</h3>
              {r.error ? (
                <p className="mt-2 text-muted-foreground">{r.error}</p>
              ) : (
                <dl className="mt-2 grid grid-cols-1 gap-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("simulator.saving")}</dt>
                    <dd>{formatMoney(r.saving!, d.currency, { locale })}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("simulator.payoff")}</dt>
                    <dd>{r.payoff ? formatDateFull(r.payoff, locale) : t("simulator.repaid")}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("summary.nextPayment")}</dt>
                    <dd>{formatMoney(r.next!, d.currency, { locale })}</dd>
                  </div>
                </dl>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
