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
import { Segmented } from "@/components/app/segmented"
import { Badge } from "@/components/ui/badge"
import { ChartContainer } from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { calculateLoanSchedule, toLoanEventInput, type LoanTermsSnapshot, type PrepaymentMode } from "@/domain/loan"
import { useAction } from "@/hooks/use-action"
import { addDays, formatDateFull, formatMonth } from "@/lib/dates"
import { formatMoney, formatMoneyCompact, parseMoney } from "@/lib/money"
import { HolidayEndForm, HolidayForm, LoanEditForm, RestructuringForm, type LoanDetailData as Detail } from "./loan-changes"
import { LoanSchedule } from "./loan-schedule"

type LedgerEventType = "prepayment" | "rate_change" | "reconciliation"
type ChangeForm = "edit" | "restructuring" | "holiday" | { holidayEnd: string }

export function LoanDetail({ data: d, today, canManage }: { data: Detail; today: string; canManage: boolean }) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const [eventType, setEventType] = useState<LedgerEventType | null>(null)
  const [change, setChange] = useState<ChangeForm | null>(null)
  const { run, pending } = useAction()
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
          <ConfirmDialog
            trigger={
              <Button variant="outline" disabled={pending}>
                {t("detail.close")}
              </Button>
            }
            title={t("detail.closeTitle")}
            description={t("detail.closeDescription")}
            confirmLabel={t("detail.closeConfirm")}
            destructive={false}
            onConfirm={() => run(() => closeLoanAction(d.loan.id, d.loan.version), { success: t("detail.closed") })}
          />
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
  const modeOptions = [
    { value: "reduce_term" as const, label: t("prepayment.reduce_term") },
    { value: "reduce_payment" as const, label: t("prepayment.reduce_payment") },
  ]

  const [date, setDate] = useState(today)
  const [amount, setAmount] = useState("")
  const [rate, setRate] = useState("")
  const [mode, setMode] = useState<PrepaymentMode>("reduce_term")
  const [error, setError] = useState("")
  const { pending, run } = useAction()
  const title = type === "prepayment" ? t("detail.prepay") : type === "rate_change" ? t("detail.changeRate") : t("detail.reconcile")
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = parseMoney(amount, d.currency)
    if (type !== "rate_change" && (value === null || (type === "prepayment" && value === 0))) return setError(t("event.invalidAmount"))
    const event =
      type === "rate_change"
        ? { type, date, annualRate: rate.replace(",", ".") }
        : type === "reconciliation"
          ? { type, date, balance: value! }
          : { type, date, amount: value!, mode }
    run(() => addLoanEventAction(d.loan.id, d.loan.version, event), { success: t("event.updated"), onSuccess: onClose, onError: setError })
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
