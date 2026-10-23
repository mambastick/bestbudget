"use client"

import { useTranslations, useLocale } from "next-intl"

import { LocalizedError, errorMessage } from "@/i18n/errors"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { createLoanAction } from "@/app/actions/loans"
import { DateField } from "@/components/app/date-field"
import { MoneyInput } from "@/components/app/money-input"
import { useCatalog } from "@/components/app/operations/catalog-context"
import { Segmented } from "@/components/app/segmented"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { calculateLoanSchedule, LOAN_KIND_LABELS, termForPayment, type LoanParameters, type LoanScheduleRow } from "@/domain/loan"
import { useAction } from "@/hooks/use-action"
import { addMonths } from "@/lib/dates"
import { formatMoney, parseMoney } from "@/lib/money"
import type { LoanInput } from "@/server/services/loans"
import { LoanSchedule } from "./loan-schedule"

export function LoanWizard() {
  const t = useTranslations("loans")
  const locale = useLocale()
  const { today, accounts, currency: baseCurrency } = useCatalog()
  const usable = accounts.filter((a) => !a.archived && a.kind !== "loan")
  const [mode, setMode] = useState<"new" | "existing">("existing")
  const [name, setName] = useState(t("kind.mortgage"))
  const [lender, setLender] = useState("")
  const [kind, setKind] = useState<keyof typeof LOAN_KIND_LABELS>("mortgage")
  const [accountId, setAccountId] = useState(usable[0]?.id ?? "")
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? baseCurrency
  const [principal, setPrincipal] = useState("")
  const [balance, setBalance] = useState("")
  const [rate, setRate] = useState("")
  const [termMode, setTermMode] = useState<"term" | "payment">("term")
  const [months, setMonths] = useState("180")
  const [payment, setPayment] = useState("")
  const [trackingDate, setTrackingDate] = useState(today)
  const [startDate, setStartDate] = useState(today)
  const [firstPayment, setFirstPayment] = useState(addMonths(today, 1))
  const [paymentDay, setPaymentDay] = useState(String(Number(firstPayment.slice(8))))
  const [scheduleType, setScheduleType] = useState<LoanParameters["scheduleType"]>("annuity")
  const [interestMethod, setInterestMethod] = useState<LoanParameters["interestMethod"]>("daily_actual")
  const [preview, setPreview] = useState<{ input: LoanInput; rows: LoanScheduleRow[] } | null>(null)
  const [error, setError] = useState("")
  const { run, pending } = useAction()
  const router = useRouter()

  function buildPreview(e: React.FormEvent) {
    e.preventDefault()
    try {
      const debt = parseMoney(balance, currency)
      const original = mode === "existing" && principal ? parseMoney(principal, currency) : debt
      if (!debt || !original || original < debt || !name.trim() || !lender.trim() || !accountId) throw new Error(t("wizard.invalid"))
      const annualRate = rate.replace(",", ".")
      const monthlyPayment = mode === "existing" && termMode === "payment" ? parseMoney(payment, currency) : null
      if (mode === "existing" && termMode === "payment" && !monthlyPayment) throw new Error(t("wizard.paymentRequired"))
      const termMonths = monthlyPayment ? termForPayment(debt, annualRate, monthlyPayment) : Number(months)
      const input: LoanInput = {
        name,
        lender,
        kind,
        principal: original,
        trackingBalance: debt,
        annualRate,
        startDate: mode === "new" ? trackingDate : startDate,
        trackingDate,
        firstPaymentDate: firstPayment,
        paymentDay: Number(paymentDay),
        termMonths,
        paymentAmount: monthlyPayment,
        scheduleType,
        interestMethod,
        paymentAccountId: accountId,
      }
      if (input.startDate > trackingDate || trackingDate > today) throw new Error(t("wizard.invalidDates"))
      const rows = calculateLoanSchedule({ ...input, termMonths })
      setError("")
      setPreview({ input, rows })
    } catch (err) {
      setError(
        err instanceof LocalizedError
          ? errorMessage(err.messageKey, err.params, locale)
          : err instanceof Error
            ? err.message
            : t("wizard.checkParameters"),
      )
    }
  }

  if (preview)
    return (
      <div className="grid grid-cols-1 gap-5">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t("wizard.preview")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm">
            <p>
              {name} · {lender} · {Number(rate.replace(",", ".")).toLocaleString(locale, { maximumFractionDigits: 6 })}% · {currency}
            </p>
            <p>
              {t.rich("wizard.previewAmounts", {
                first: formatMoney(preview.rows[0]!.payment, currency, { locale }),
                interest: formatMoney(
                  preview.rows.reduce((s, r) => s + r.interest, 0),
                  currency,
                  { locale },
                ),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
            <p className="text-muted-foreground">{t("wizard.calculationHint")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPreview(null)}>
                {t("wizard.back")}
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  run(() => createLoanAction(preview.input), {
                    success: t("wizard.created"),
                    onSuccess: (r) => router.push(`/loans/${r.id}`),
                    onError: setError,
                  })
                }
              >
                {t("wizard.save")}
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <LoanSchedule rows={preview.rows} today={today} currency={currency} />
      </div>
    )

  return (
    <form onSubmit={buildPreview} className="grid grid-cols-1 gap-5">
      <Segmented
        value={mode}
        onChange={setMode}
        aria-label={t("wizard.trackingMode")}
        options={[
          { value: "new", label: t("page.new") },
          { value: "existing", label: t("wizard.existing") },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("wizard.parameters")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="loan-name">{t("wizard.name")}</FieldLabel>
            <Input id="loan-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-lender">{t("wizard.lender")}</FieldLabel>
            <Input id="loan-lender" value={lender} onChange={(e) => setLender(e.target.value)} required maxLength={120} />
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-kind">{t("wizard.kind")}</FieldLabel>
            <Select
              value={kind}
              onValueChange={(v) => v && setKind(v as typeof kind)}
              items={Object.entries(LOAN_KIND_LABELS).map(([value, label]) => ({ value, label: t(label) }))}
            >
              <SelectTrigger id="loan-kind" className="w-full">
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
            <FieldLabel htmlFor="loan-account">{t("wizard.account")}</FieldLabel>
            <Select
              value={accountId}
              onValueChange={(v) => v && setAccountId(v)}
              items={usable.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` }))}
            >
              <SelectTrigger id="loan-account" className="w-full">
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
            <p className="text-xs text-muted-foreground">{t("wizard.currencyHint", { currency })}</p>
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-balance">{mode === "new" ? t("wizard.amount") : t("wizard.currentBalance")}</FieldLabel>
            <MoneyInput id="loan-balance" currency={currency} value={balance} onChange={setBalance} />
          </Field>
          {mode === "existing" ? (
            <Field>
              <FieldLabel htmlFor="loan-principal">{t("wizard.originalAmount")}</FieldLabel>
              <MoneyInput id="loan-principal" currency={currency} value={principal} onChange={setPrincipal} />
              <p className="text-xs text-muted-foreground">{t("wizard.originalHint")}</p>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="loan-rate">{t("wizard.rate")}</FieldLabel>
            <Input id="loan-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-tracking">{mode === "new" ? t("wizard.issued") : t("wizard.balanceDate")}</FieldLabel>
            <DateField id="loan-tracking" value={trackingDate} onChange={(d) => d && setTrackingDate(d)} today={today} />
          </Field>
          {mode === "existing" ? (
            <Field>
              <FieldLabel htmlFor="loan-start">{t("wizard.startDate")}</FieldLabel>
              <DateField id="loan-start" value={startDate} onChange={(d) => d && setStartDate(d)} today={today} />
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="loan-first">{t("wizard.nextDate")}</FieldLabel>
            <DateField
              id="loan-first"
              value={firstPayment}
              onChange={(d) => {
                if (d) {
                  setFirstPayment(d)
                  setPaymentDay(String(Number(d.slice(8))))
                }
              }}
              today={today}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-day">{t("wizard.paymentDay")}</FieldLabel>
            <Input
              id="loan-day"
              type="number"
              min={1}
              max={31}
              value={paymentDay}
              onChange={(e) => setPaymentDay(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">{t("wizard.shortMonth")}</p>
          </Field>
          <Field>
            <FieldLabel>{t("wizard.schedule")}</FieldLabel>
            <Segmented
              size="sm"
              value={scheduleType}
              onChange={(v) => {
                setScheduleType(v)
                setTermMode("term")
              }}
              options={[
                { value: "annuity", label: t("wizard.annuity") },
                { value: "differentiated", label: t("wizard.equalPrincipal") },
              ]}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-method">{t("wizard.interestMethod")}</FieldLabel>
            <Select
              value={interestMethod}
              onValueChange={(v) => v && setInterestMethod(v as typeof interestMethod)}
              items={[
                { value: "monthly", label: t("wizard.monthly") },
                { value: "daily_365", label: t("wizard.daily365") },
                { value: "daily_actual", label: t("wizard.dailyActual") },
              ]}
            >
              <SelectTrigger id="loan-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">{t("wizard.monthly")}</SelectItem>
                <SelectItem value="daily_365">{t("wizard.daily365")}</SelectItem>
                <SelectItem value="daily_actual">{t("wizard.dailyActual")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {mode === "existing" && scheduleType === "annuity" ? (
            <Field>
              <FieldLabel>{t("wizard.known")}</FieldLabel>
              <Segmented
                value={termMode}
                onChange={setTermMode}
                size="sm"
                options={[
                  { value: "term", label: t("wizard.remainingTerm") },
                  { value: "payment", label: t("schedule.payment") },
                ]}
              />
            </Field>
          ) : null}
          {mode === "existing" && termMode === "payment" ? (
            <Field>
              <FieldLabel htmlFor="loan-payment">{t("wizard.monthlyPayment")}</FieldLabel>
              <MoneyInput id="loan-payment" currency={currency} value={payment} onChange={setPayment} />
              <p className="text-xs text-muted-foreground">{t("wizard.termHint")}</p>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="loan-months">{mode === "new" ? t("wizard.months") : t("wizard.monthsLeft")}</FieldLabel>
              <Input id="loan-months" type="number" min={1} max={600} required value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
          )}
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">{t("wizard.ledgerHint")}</p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="justify-self-start">
        {t("wizard.preview")}
      </Button>
    </form>
  )
}
