"use client"

import { useLocale, useTranslations } from "next-intl"
import { useState } from "react"
import { addLoanEventAction, updateLoanAction, updateLoanHolidayEndAction } from "@/app/actions/loans"
import { DateField } from "@/components/app/date-field"
import { MoneyInput } from "@/components/app/money-input"
import { useCatalog } from "@/components/app/operations/catalog-context"
import { Segmented } from "@/components/app/segmented"
import { Button } from "@/components/ui/button"
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  calculateLoanSchedule,
  LOAN_KIND_LABELS,
  LoanCalculationError,
  loanEndDate,
  toLoanEventInput,
  loanSnapshot,
  loanTermUntil,
  nextPaymentOn,
  termForPayment,
  type HolidayInterest,
  type HolidayMode,
  type HolidayShift,
  type LoanEventInput,
  type LoanParameters,
  type LoanTerms,
  type LoanTermsSnapshot,
} from "@/domain/loan"
import { LocalizedError, errorMessage } from "@/i18n/errors"
import { useAction } from "@/hooks/use-action"
import { addDays, addMonths, daysInMonth, formatDateFull, isIsoDate, makeDate, ymd } from "@/lib/dates"
import { formatMoney, minorToInput, parseMoney } from "@/lib/money"
import type { getLoan } from "@/server/services/loans"

export type LoanDetailData = Awaited<ReturnType<typeof getLoan>>

interface TermsDraft {
  rate: string
  next: string
  day: string
  months: string
  calculate: "payment" | "term" | "both"
  payment: string
  scheduleType: LoanParameters["scheduleType"]
  interestMethod: LoanParameters["interestMethod"]
}

function initialDraft(d: LoanDetailData, after: string, locale: string): TermsDraft {
  const upcoming = d.rows.filter((r) => r.kind === "scheduled" && r.date > after)
  const contractPayment = d.terms.scheduleType === "annuity" ? d.terms.paymentAmount : null
  return {
    rate: Number(d.terms.annualRate).toLocaleString(locale, { maximumFractionDigits: 6, useGrouping: false }),
    next: upcoming[0]?.date ?? nextPaymentOn(after, d.terms.paymentDay),
    day: String(d.terms.paymentDay),
    months: String(Math.max(1, upcoming.filter((r) => r.principal > 0).length)),
    calculate: contractPayment ? "both" : "payment",
    payment: minorToInput(contractPayment ?? upcoming[0]?.payment ?? 0, d.currency, locale),
    scheduleType: d.terms.scheduleType,
    interestMethod: d.terms.interestMethod,
  }
}

/** Reads the draft into exact terms; a term derived from a payment depends on the balance it repays. */
function draftTerms(draft: TermsDraft, balance: number, currency: string): LoanTerms {
  const annualRate = draft.rate.trim().replace(",", ".")
  const usesPayment = draft.scheduleType === "annuity" && draft.calculate !== "payment"
  const paymentAmount = usesPayment ? parseMoney(draft.payment, currency) : null
  if (usesPayment && !paymentAmount) throw new LoanCalculationError("loanCalculation.positivePayment")
  return {
    annualRate,
    nextPaymentDate: draft.next,
    paymentDay: Number(draft.day),
    termMonths: usesPayment && draft.calculate === "term" ? termForPayment(balance, annualRate, paymentAmount!) : Number(draft.months),
    paymentAmount,
    scheduleType: draft.scheduleType,
    interestMethod: draft.interestMethod,
  }
}

function useErrorText() {
  const locale = useLocale()
  const t = useTranslations("loans")
  return (e: unknown) => (e instanceof LocalizedError ? errorMessage(e.messageKey, e.params, locale) : t("simulator.checkParameters"))
}

function TermsFields({
  draft,
  onChange,
  today,
  after,
  currency,
  derivedMonths,
}: {
  draft: TermsDraft
  onChange: (draft: TermsDraft) => void
  today: string
  /** The new grid has to start later than this date. */
  after: string
  currency: string
  /** The term following from the payment, shown in place of the term inputs. */
  derivedMonths: number | null
}) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const set = (patch: Partial<TermsDraft>) => onChange({ ...draft, ...patch })
  const day = Number(draft.day)
  const validGrid = isIsoDate(draft.next) && Number.isInteger(day) && day >= 1 && day <= 31
  const months = derivedMonths ?? Number(draft.months)
  const endDate = validGrid && Number.isInteger(months) && months >= 1 && months <= 600 ? loanEndDate(draft.next, months, day) : null
  const differentiated = draft.scheduleType === "differentiated"
  const calculate = differentiated ? "payment" : draft.calculate
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="loan-terms-rate">{t("wizard.rate")}</FieldLabel>
        <Input id="loan-terms-rate" required inputMode="decimal" value={draft.rate} onChange={(e) => set({ rate: e.target.value })} />
      </Field>
      <Field>
        <FieldLabel htmlFor="loan-terms-next">{t("terms.next")}</FieldLabel>
        <DateField
          id="loan-terms-next"
          value={draft.next}
          today={today}
          onChange={(next) => {
            if (!next) return
            const { y, m, d } = ymd(next)
            // A date that cannot fall on the current day of the month moves the day along with it.
            set({ next, day: d === Math.min(day, daysInMonth(y, m)) ? draft.day : String(d) })
          }}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="loan-terms-day">{t("wizard.paymentDay")}</FieldLabel>
        <Input
          id="loan-terms-day"
          required
          inputMode="numeric"
          value={draft.day}
          onChange={(e) => {
            const value = Number(e.target.value)
            if (!Number.isInteger(value) || value < 1 || value > 31) return set({ day: e.target.value })
            // The same month when possible, otherwise the first such day after the change takes effect.
            const { y, m } = ymd(isIsoDate(draft.next) ? draft.next : today)
            const inMonth = makeDate(y, m, Math.min(value, daysInMonth(y, m)))
            set({ day: e.target.value, next: inMonth > after ? inMonth : nextPaymentOn(after, value) })
          }}
        />
        <p className="text-xs text-muted-foreground">{t("wizard.shortMonth")}</p>
      </Field>
      <Field>
        <FieldLabel>{t("wizard.schedule")}</FieldLabel>
        <Segmented
          size="sm"
          aria-label={t("wizard.schedule")}
          value={draft.scheduleType}
          onChange={(scheduleType) => set({ scheduleType })}
          options={[
            { value: "annuity", label: t("wizard.annuity") },
            { value: "differentiated", label: t("wizard.equalPrincipal") },
          ]}
        />
      </Field>
      <Field className="sm:col-span-2">
        <FieldLabel htmlFor="loan-terms-method">{t("wizard.interestMethod")}</FieldLabel>
        <Select
          value={draft.interestMethod}
          onValueChange={(v) => v && set({ interestMethod: v as TermsDraft["interestMethod"] })}
          items={[
            { value: "monthly", label: t("wizard.monthly") },
            { value: "daily_365", label: t("wizard.daily365") },
            { value: "daily_actual", label: t("wizard.dailyActual") },
          ]}
        >
          <SelectTrigger id="loan-terms-method" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="monthly">{t("wizard.monthly")}</SelectItem>
            <SelectItem value="daily_365">{t("wizard.daily365")}</SelectItem>
            <SelectItem value="daily_actual">{t("wizard.dailyActual")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {differentiated ? null : (
        <Field className="sm:col-span-2">
          <FieldLabel>{t("terms.calculate")}</FieldLabel>
          <Segmented
            size="sm"
            aria-label={t("terms.calculate")}
            value={calculate}
            onChange={(next) => set({ calculate: next })}
            options={[
              { value: "payment", label: t("terms.calculatePayment") },
              { value: "term", label: t("terms.calculateTerm") },
              { value: "both", label: t("terms.calculateBoth") },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            {calculate === "payment"
              ? t("terms.calculatePaymentHint")
              : calculate === "term"
                ? t("terms.calculateTermHint")
                : t("terms.calculateBothHint")}
          </p>
        </Field>
      )}
      <Field>
        <FieldLabel htmlFor="loan-terms-months">{t("terms.months")}</FieldLabel>
        <Input
          id="loan-terms-months"
          inputMode="numeric"
          disabled={calculate === "term"}
          value={calculate === "term" ? (derivedMonths ?? "") : draft.months}
          onChange={(e) => set({ months: e.target.value })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="loan-terms-end">{t("terms.end")}</FieldLabel>
        {calculate === "term" ? (
          <Input id="loan-terms-end" disabled value={endDate ? formatDateFull(endDate, locale) : ""} />
        ) : (
          <DateField
            id="loan-terms-end"
            value={endDate}
            today={today}
            onChange={(end) => {
              const term = end && validGrid ? loanTermUntil(draft.next, day, end) : null
              if (term) set({ months: String(term) })
            }}
          />
        )}
        <p className="text-xs text-muted-foreground">{t("terms.endHint")}</p>
      </Field>
      {differentiated || calculate === "payment" ? null : (
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor="loan-terms-payment">{t("wizard.monthlyPayment")}</FieldLabel>
          <MoneyInput id="loan-terms-payment" currency={currency} value={draft.payment} onChange={(payment) => set({ payment })} />
        </Field>
      )}
    </div>
  )
}

function ChangeImpact({
  before,
  after,
  currency,
  error,
  children,
}: {
  before?: LoanTermsSnapshot
  after?: LoanTermsSnapshot
  currency: string
  error?: string
  children?: React.ReactNode
}) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const money = (value: number | null) => (value === null ? "—" : formatMoney(value, currency, { locale }))
  const date = (value: string | null) => (value ? formatDateFull(value, locale) : "—")
  const lines =
    before && after
      ? [
          [t("change.rate"), `${Number(before.annualRate).toLocaleString(locale, { maximumFractionDigits: 6 })}%`, `${Number(after.annualRate).toLocaleString(locale, { maximumFractionDigits: 6 })}%`],
          [t("summary.nextPayment"), `${money(before.nextPayment)} · ${date(before.nextPaymentDate)}`, `${money(after.nextPayment)} · ${date(after.nextPaymentDate)}`],
          [t("change.remaining"), String(before.remainingPayments), String(after.remainingPayments)],
          [t("summary.payoffDate"), date(before.endDate), date(after.endDate)],
          [t("change.balance"), money(before.balance), money(after.balance)],
          [t("change.interestAhead"), money(before.futureInterest), money(after.futureInterest)],
        ]
      : []
  return (
    <section className="grid grid-cols-1 gap-2 rounded-xl border p-3" aria-live="polite" aria-label={t("change.title")}>
      <h3 className="font-medium">{t("change.title")}</h3>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        <>
          {children}
          <dl className="grid grid-cols-1 gap-2">
            {lines.map(([label, was, will]) => (
              <div key={label} className="grid min-w-0 grid-cols-1 gap-0.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] sm:gap-3">
                <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
                <dd className="break-words">
                  {was === will ? (
                    will
                  ) : (
                    <>
                      <span className="text-muted-foreground">{was}</span> → <span className="font-medium">{will}</span>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}

function FormError({ text }: { text: string }) {
  return text ? (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  ) : null
}

function FormButtons({ pending, disabled, onClose }: { pending: boolean; disabled?: boolean; onClose: () => void }) {
  const t = useTranslations("loans")
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onClose}>
        {t("actions.cancel")}
      </Button>
      <Button type="submit" disabled={pending || disabled}>
        {t("actions.save")}
      </Button>
    </DialogFooter>
  )
}

export function LoanEditForm({ data: d, today, onClose }: { data: LoanDetailData; today: string; onClose: () => void }) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const errorText = useErrorText()
  const { accounts } = useCatalog()
  const { run, pending } = useAction()
  const usable = accounts.filter((a) => a.id === d.loan.paymentAccountId || (!a.archived && a.kind !== "loan" && a.currency === d.currency))
  const [name, setName] = useState(d.name)
  const [lender, setLender] = useState(d.loan.lender)
  const [kind, setKind] = useState<keyof typeof LOAN_KIND_LABELS>(d.loan.kind)
  const [principal, setPrincipal] = useState(minorToInput(d.loan.principal, d.currency, locale))
  const [startDate, setStartDate] = useState(d.loan.startDate)
  const [paymentAccountId, setPaymentAccountId] = useState(d.loan.paymentAccountId)
  const [trackingDate, setTrackingDate] = useState(d.loan.trackingDate)
  const [trackingBalance, setTrackingBalance] = useState(minorToInput(d.loan.trackingBalance, d.currency, locale))
  const [initial] = useState(() => initialDraft(d, d.editBoundary, locale))
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState("")
  const boundary = d.editBoundary
  const events = d.events.map(toLoanEventInput)
  const tracked = d.hasHistory ? d.loan.trackingBalance : (parseMoney(trackingBalance, d.currency) ?? 0)
  const trackingDirty = !d.hasHistory && (trackingDate !== d.loan.trackingDate || tracked !== d.loan.trackingBalance)
  const termsDirty = trackingDirty || JSON.stringify(draft) !== JSON.stringify(initial)
  let impact: { before?: LoanTermsSnapshot; after?: LoanTermsSnapshot; error?: string; terms?: LoanTerms } = {}
  if (termsDirty) {
    try {
      const openingAt = d.hasHistory ? boundary : trackingDate
      const before = loanSnapshot(d.loan, events, d.posted, boundary)
      const terms = draftTerms(draft, d.hasHistory ? before.balance : tracked, d.currency)
      if (d.hasHistory) {
        const onBoundary = d.events.find((e) => e.date === boundary && (e.type === "correction" || e.type === "restructuring"))
        const others = d.events.filter((e) => e.id !== onBoundary?.id).map(toLoanEventInput)
        const correction: LoanEventInput = { type: "correction", date: boundary, balance: onBoundary?.balance, ...terms }
        impact = { before, after: loanSnapshot(d.loan, [...others, correction], d.posted, boundary), terms }
      } else {
        const params: LoanParameters = {
          ...terms,
          trackingBalance: tracked,
          trackingDate,
          firstPaymentDate: terms.nextPaymentDate,
        }
        impact = { before, after: loanSnapshot(params, [], [], openingAt), terms }
      }
    } catch (e) {
      impact = { error: errorText(e) }
    }
  }
  const derivedMonths = draft.calculate === "term" ? (impact.terms?.termMonths ?? null) : null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const original = parseMoney(principal, d.currency)
    if (!original) return setError(t("event.invalidAmount"))
    if (impact.error) return setError(impact.error)
    run(
      () =>
        updateLoanAction(d.loan.id, d.loan.version, {
          name,
          lender,
          kind,
          principal: original,
          startDate,
          paymentAccountId,
          terms: impact.terms
            ? { ...impact.terms, ...(trackingDirty ? { trackingDate, trackingBalance: tracked } : {}) }
            : null,
        }),
      { success: t("edit.saved"), onSuccess: onClose, onError: setError },
    )
  }

  return (
    <form className="grid min-w-0 grid-cols-1 gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{t("edit.title")}</DialogTitle>
        <DialogDescription>{t("edit.description")}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="loan-edit-name">{t("wizard.name")}</FieldLabel>
          <Input id="loan-edit-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        </Field>
        <Field>
          <FieldLabel htmlFor="loan-edit-lender">{t("wizard.lender")}</FieldLabel>
          <Input id="loan-edit-lender" value={lender} onChange={(e) => setLender(e.target.value)} required maxLength={120} />
        </Field>
        <Field>
          <FieldLabel htmlFor="loan-edit-kind">{t("wizard.kind")}</FieldLabel>
          <Select
            value={kind}
            onValueChange={(v) => v && setKind(v as typeof kind)}
            items={Object.entries(LOAN_KIND_LABELS).map(([value, label]) => ({ value, label: t(label) }))}
          >
            <SelectTrigger id="loan-edit-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LOAN_KIND_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {t(label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="loan-edit-account">{t("wizard.account")}</FieldLabel>
          <Select
            value={paymentAccountId}
            onValueChange={(v) => v && setPaymentAccountId(v)}
            items={usable.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
          >
            <SelectTrigger id="loan-edit-account" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {usable.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="loan-edit-principal">{t("edit.principal")}</FieldLabel>
          <MoneyInput id="loan-edit-principal" currency={d.currency} value={principal} onChange={setPrincipal} />
        </Field>
        <Field>
          <FieldLabel htmlFor="loan-edit-start">{t("wizard.issued")}</FieldLabel>
          <DateField id="loan-edit-start" value={startDate} today={today} onChange={(v) => v && setStartDate(v)} />
        </Field>
      </div>
      <section className="grid min-w-0 grid-cols-1 gap-4">
        <div>
          <h3 className="font-medium">{t("edit.terms")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {d.hasHistory ? t("edit.hintHistory", { date: formatDateFull(boundary, locale) }) : t("edit.hintFresh")}
          </p>
        </div>
        {d.hasHistory ? (
          <p className="text-xs text-muted-foreground">
            {t("edit.locked", {
              date: formatDateFull(d.loan.trackingDate, locale),
              amount: formatMoney(d.loan.trackingBalance, d.currency, { locale }),
            })}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="loan-edit-tracking">{t("wizard.balanceDate")}</FieldLabel>
              <DateField id="loan-edit-tracking" value={trackingDate} today={today} onChange={(v) => v && setTrackingDate(v)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="loan-edit-balance">{t("wizard.currentBalance")}</FieldLabel>
              <MoneyInput id="loan-edit-balance" currency={d.currency} value={trackingBalance} onChange={setTrackingBalance} />
            </Field>
          </div>
        )}
        <TermsFields
          draft={draft}
          onChange={setDraft}
          today={today}
          after={d.hasHistory ? boundary : trackingDate}
          currency={d.currency}
          derivedMonths={derivedMonths}
        />
        {termsDirty ? <ChangeImpact before={impact.before} after={impact.after} error={impact.error} currency={d.currency} /> : null}
      </section>
      <FormError text={error} />
      <FormButtons pending={pending} onClose={onClose} />
    </form>
  )
}

export function RestructuringForm({ data: d, today, onClose }: { data: LoanDetailData; today: string; onClose: () => void }) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const errorText = useErrorText()
  const { run, pending } = useAction()
  const [date, setDate] = useState(today > d.editBoundary ? today : d.editBoundary)
  const [balance, setBalance] = useState(minorToInput(d.debt, d.currency, locale))
  const [draft, setDraft] = useState(() => {
    const initial = initialDraft(d, date, locale)
    return { ...initial, next: nextPaymentOn(date, Number(initial.day)) }
  })
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const ahead = date > today
  const events = d.events.map(toLoanEventInput)
  const unpaid = d.rows.filter((r) => r.kind === "scheduled" && r.status === "planned" && r.date <= date).length
  let impact: { before?: LoanTermsSnapshot; after?: LoanTermsSnapshot; error?: string; event?: Extract<LoanEventInput, { type: "restructuring" }> } = {}
  try {
    const before = loanSnapshot(d.loan, events, d.posted, date)
    const stated = ahead ? null : parseMoney(balance, d.currency)
    if (!ahead && stated === null) throw new LoanCalculationError("loanCalculation.eventAmount")
    const event = { type: "restructuring" as const, date, balance: stated, ...draftTerms(draft, stated ?? before.balance, d.currency) }
    impact = { before, after: loanSnapshot(d.loan, [...events, event], d.posted, date), event }
  } catch (e) {
    impact = { error: errorText(e) }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!impact.event) return setError(impact.error ?? t("simulator.checkParameters"))
    const event = impact.event
    run(() => addLoanEventAction(d.loan.id, d.loan.version, { ...event, note: note.trim() || undefined }), {
      success: t("restructure.saved"),
      onSuccess: onClose,
      onError: setError,
    })
  }

  return (
    <form className="grid min-w-0 grid-cols-1 gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{t("restructure.title")}</DialogTitle>
        <DialogDescription>{t("restructure.description")}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="loan-restructure-date">{t("restructure.date")}</FieldLabel>
          <DateField
            id="loan-restructure-date"
            value={date}
            today={today}
            onChange={(v) => {
              if (!v) return
              setDate(v)
              if (draft.next <= v) setDraft({ ...draft, next: nextPaymentOn(v, Number(draft.day) || 1) })
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="loan-restructure-balance">{t("restructure.balance")}</FieldLabel>
          <MoneyInput
            id="loan-restructure-balance"
            currency={d.currency}
            disabled={ahead}
            value={ahead ? minorToInput(impact.before?.balance ?? d.debt, d.currency, locale) : balance}
            onChange={setBalance}
          />
          <p className="text-xs text-muted-foreground">{ahead ? t("restructure.balanceAhead") : t("restructure.balanceHint")}</p>
        </Field>
      </div>
      {!ahead && unpaid > 0 ? <p className="text-sm text-muted-foreground">{t("restructure.unpaid", { count: unpaid })}</p> : null}
      <TermsFields
        draft={draft}
        onChange={setDraft}
        today={today}
        after={date}
        currency={d.currency}
        derivedMonths={draft.calculate === "term" ? (impact.event?.termMonths ?? null) : null}
      />
      <Field>
        <FieldLabel htmlFor="loan-restructure-note">{t("change.note")}</FieldLabel>
        <Input id="loan-restructure-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ChangeImpact before={impact.before} after={impact.after} error={impact.error} currency={d.currency} />
      <FormError text={error} />
      <FormButtons pending={pending} onClose={onClose} />
    </form>
  )
}

export function HolidayForm({ data: d, today, onClose }: { data: LoanDetailData; today: string; onClose: () => void }) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const errorText = useErrorText()
  const { run, pending } = useAction()
  const [date, setDate] = useState(d.next?.date ?? today)
  const [endDate, setEndDate] = useState(addDays(addMonths(d.next?.date ?? today, 6), -1))
  const [mode, setMode] = useState<HolidayMode>("no_payment")
  const [interest, setInterest] = useState<HolidayInterest>("deferred_end")
  const [shift, setShift] = useState<HolidayShift>("extend_term")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const event: Extract<LoanEventInput, { type: "holiday" }> = {
    type: "holiday",
    date,
    endDate,
    mode,
    interest: mode === "no_payment" ? interest : null,
    shift,
  }
  const events = d.events.map(toLoanEventInput)
  let impact: { before?: LoanTermsSnapshot; after?: LoanTermsSnapshot; error?: string; slots?: { date: string; accrued: number }[] } = {}
  try {
    const rows = calculateLoanSchedule(d.loan, [...events, event], d.posted)
    impact = {
      before: loanSnapshot(d.loan, events, d.posted, addDays(date, -1)),
      after: loanSnapshot(d.loan, [...events, event], d.posted, addDays(date, -1)),
      slots: rows
        .filter((r) => r.date >= date && r.date <= endDate && (r.kind === "holiday" || (mode === "interest_only" && r.kind === "scheduled")))
        .map((r) => ({ date: r.date, accrued: r.accrued ?? 0 })),
    }
  } catch (e) {
    impact = { error: errorText(e) }
  }
  const accrued = impact.slots?.reduce((s, r) => s + r.accrued, 0) ?? 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (impact.error) return setError(impact.error)
    run(() => addLoanEventAction(d.loan.id, d.loan.version, { ...event, note: note.trim() || undefined }), {
      success: t("holiday.saved"),
      onSuccess: onClose,
      onError: setError,
    })
  }

  const interestOptions: HolidayInterest[] = ["deferred_end", "deferred_spread", "capitalize", "waived"]
  return (
    <form className="grid min-w-0 grid-cols-1 gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{t("holiday.title")}</DialogTitle>
        <DialogDescription>{t("holiday.description")}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="loan-holiday-start">{t("holiday.start")}</FieldLabel>
          <DateField
            id="loan-holiday-start"
            value={date}
            today={today}
            onChange={(v) => {
              if (!v) return
              setDate(v)
              if (endDate < v) setEndDate(addDays(addMonths(v, 6), -1))
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="loan-holiday-end">{t("holiday.end")}</FieldLabel>
          <DateField id="loan-holiday-end" value={endDate} today={today} onChange={(v) => v && setEndDate(v)} />
        </Field>
      </div>
      <Field>
        <FieldLabel>{t("holiday.mode")}</FieldLabel>
        <Segmented
          size="sm"
          aria-label={t("holiday.mode")}
          value={mode}
          onChange={setMode}
          options={[
            { value: "no_payment", label: t("holiday.modeNoPayment") },
            { value: "interest_only", label: t("holiday.modeInterestOnly") },
          ]}
        />
      </Field>
      {mode === "no_payment" ? (
        <Field>
          <FieldLabel htmlFor="loan-holiday-interest">{t("holiday.interest")}</FieldLabel>
          <Select
            value={interest}
            onValueChange={(v) => v && setInterest(v as HolidayInterest)}
            items={interestOptions.map((value) => ({ value, label: t(`holiday.interestOption.${value}`) }))}
          >
            <SelectTrigger id="loan-holiday-interest" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {interestOptions.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`holiday.interestOption.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t(`holiday.interestHint.${interest}`)}</p>
        </Field>
      ) : null}
      <Field>
        <FieldLabel>{t("holiday.shift")}</FieldLabel>
        <Segmented
          size="sm"
          aria-label={t("holiday.shift")}
          value={shift}
          onChange={setShift}
          options={[
            { value: "extend_term", label: t("holiday.shiftExtend") },
            { value: "keep_term", label: t("holiday.shiftKeep") },
          ]}
        />
        <p className="text-xs text-muted-foreground">{shift === "extend_term" ? t("holiday.shiftExtendHint") : t("holiday.shiftKeepHint")}</p>
      </Field>
      <Field>
        <FieldLabel htmlFor="loan-holiday-note">{t("change.note")}</FieldLabel>
        <Input id="loan-holiday-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <ChangeImpact before={impact.before} after={impact.after} error={impact.error} currency={d.currency}>
        {impact.slots?.length ? (
          <p className="text-sm">
            {t(mode === "no_payment" ? "holiday.skipped" : "holiday.interestOnlySlots", {
              count: impact.slots.length,
              from: formatDateFull(impact.slots[0]!.date, locale),
              to: formatDateFull(impact.slots.at(-1)!.date, locale),
            })}
            {mode === "no_payment" ? ` ${t("holiday.accrued", { amount: formatMoney(accrued, d.currency, { locale }) })}` : ""}
          </p>
        ) : null}
      </ChangeImpact>
      <FormError text={error} />
      <FormButtons pending={pending} disabled={Boolean(impact.error)} onClose={onClose} />
    </form>
  )
}

export function HolidayEndForm({
  data: d,
  eventId,
  today,
  onClose,
}: {
  data: LoanDetailData
  eventId: string
  today: string
  onClose: () => void
}) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const errorText = useErrorText()
  const { run, pending } = useAction()
  const holiday = d.events.find((e) => e.id === eventId)!
  const [endDate, setEndDate] = useState(holiday.endDate!)
  const [error, setError] = useState("")
  const events = d.events.map(toLoanEventInput)
  const moved = d.events.map((e) => (e.id === eventId ? { ...e, endDate } : e)).map(toLoanEventInput)
  let impact: { before?: LoanTermsSnapshot; after?: LoanTermsSnapshot; error?: string } = {}
  try {
    const at = addDays(holiday.date, -1)
    impact = { before: loanSnapshot(d.loan, events, d.posted, at), after: loanSnapshot(d.loan, moved, d.posted, at) }
  } catch (e) {
    impact = { error: errorText(e) }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (impact.error) return setError(impact.error)
    run(() => updateLoanHolidayEndAction(d.loan.id, d.loan.version, eventId, endDate), {
      success: t("holiday.endSaved"),
      onSuccess: onClose,
      onError: setError,
    })
  }

  return (
    <form className="grid min-w-0 grid-cols-1 gap-5" onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>{t("holiday.endTitle")}</DialogTitle>
        <DialogDescription>{t("holiday.endHint", { date: formatDateFull(today, locale) })}</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="loan-holiday-new-end">{t("holiday.end")}</FieldLabel>
        <DateField id="loan-holiday-new-end" value={endDate} today={today} onChange={(v) => v && setEndDate(v)} />
      </Field>
      <ChangeImpact before={impact.before} after={impact.after} error={impact.error} currency={d.currency} />
      <FormError text={error} />
      <FormButtons pending={pending} disabled={Boolean(impact.error)} onClose={onClose} />
    </form>
  )
}
