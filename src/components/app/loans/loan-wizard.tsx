"use client"

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
  const { today, accounts, currency: baseCurrency } = useCatalog()
  const usable = accounts.filter((a) => !a.archived && a.kind !== "loan")
  const [mode, setMode] = useState<"new" | "existing">("existing")
  const [name, setName] = useState("Ипотека")
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
      if (!debt || !original || original < debt || !name.trim() || !lender.trim() || !accountId)
        throw new Error("Укажите название, банк, счёт и корректные суммы")
      const annualRate = rate.replace(",", ".")
      const monthlyPayment = mode === "existing" && termMode === "payment" ? parseMoney(payment, currency) : null
      if (mode === "existing" && termMode === "payment" && !monthlyPayment) throw new Error("Укажите ежемесячный платёж")
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
      if (input.startDate > trackingDate || trackingDate > today) throw new Error("Проверьте даты кредита и начала учёта")
      const rows = calculateLoanSchedule({ ...input, termMonths })
      setError("")
      setPreview({ input, rows })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Проверьте параметры кредита")
    }
  }

  if (preview)
    return (
      <div className="grid grid-cols-1 gap-5">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Предпросмотр графика</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm">
            <p>
              {name} · {lender} · {rate}% · {currency}
            </p>
            <p>
              Первый платёж: <strong>{formatMoney(preview.rows[0]!.payment, currency)}</strong>. Проценты за оставшийся срок:{" "}
              <strong>
                {formatMoney(
                  preview.rows.reduce((s, r) => s + r.interest, 0),
                  currency,
                )}
              </strong>
              .
            </p>
            <p className="text-muted-foreground">
              Расчёт без страховок и комиссий. Сверяйте разбивку с банком. Для дневных методов аннуитет рассчитан по r/12, последний платёж
              уточняется по фактическим дням.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setPreview(null)}>
                Назад к параметрам
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  run(() => createLoanAction(preview.input), {
                    success: "Кредит создан",
                    onSuccess: (r) => router.push(`/loans/${r.id}`),
                    onError: setError,
                  })
                }
              >
                Сохранить кредит
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
        aria-label="Начало учёта кредита"
        options={[
          { value: "new", label: "Новый кредит" },
          { value: "existing", label: "Уже выплачиваю" },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Параметры кредита</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="loan-name">Название</FieldLabel>
            <Input id="loan-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-lender">Банк</FieldLabel>
            <Input id="loan-lender" value={lender} onChange={(e) => setLender(e.target.value)} required maxLength={120} />
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-kind">Вид кредита</FieldLabel>
            <Select
              value={kind}
              onValueChange={(v) => v && setKind(v as typeof kind)}
              items={Object.entries(LOAN_KIND_LABELS).map(([value, label]) => ({ value, label }))}
            >
              <SelectTrigger id="loan-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LOAN_KIND_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-account">Счёт оплаты</FieldLabel>
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
            <p className="text-xs text-muted-foreground">Валюта кредита — {currency}, как у счёта оплаты.</p>
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-balance">{mode === "new" ? "Сумма кредита" : "Текущий остаток долга"}</FieldLabel>
            <MoneyInput id="loan-balance" currency={currency} value={balance} onChange={setBalance} />
          </Field>
          {mode === "existing" ? (
            <Field>
              <FieldLabel htmlFor="loan-principal">Исходная сумма (необязательно)</FieldLabel>
              <MoneyInput id="loan-principal" currency={currency} value={principal} onChange={setPrincipal} />
              <p className="text-xs text-muted-foreground">
                Если неизвестна, используем текущий остаток. Проценты до начала учёта не включены в переплату.
              </p>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="loan-rate">Ставка, % годовых</FieldLabel>
            <Input id="loan-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-tracking">{mode === "new" ? "Дата выдачи" : "Остаток на дату"}</FieldLabel>
            <DateField id="loan-tracking" value={trackingDate} onChange={(d) => d && setTrackingDate(d)} today={today} />
          </Field>
          {mode === "existing" ? (
            <Field>
              <FieldLabel htmlFor="loan-start">Дата начала кредита</FieldLabel>
              <DateField id="loan-start" value={startDate} onChange={(d) => d && setStartDate(d)} today={today} />
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="loan-first">Дата следующего платежа</FieldLabel>
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
            <FieldLabel htmlFor="loan-day">День платежа, 1–31</FieldLabel>
            <Input
              id="loan-day"
              type="number"
              min={1}
              max={31}
              value={paymentDay}
              onChange={(e) => setPaymentDay(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">В коротком месяце — последний день.</p>
          </Field>
          <Field>
            <FieldLabel>График</FieldLabel>
            <Segmented
              size="sm"
              value={scheduleType}
              onChange={(v) => {
                setScheduleType(v)
                setTermMode("term")
              }}
              options={[
                { value: "annuity", label: "Аннуитет" },
                { value: "differentiated", label: "Дифференцированный" },
              ]}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="loan-method">Начисление процентов</FieldLabel>
            <Select
              value={interestMethod}
              onValueChange={(v) => v && setInterestMethod(v as typeof interestMethod)}
              items={[
                { value: "monthly", label: "Ежемесячно (r/12)" },
                { value: "daily_365", label: "По дням / 365" },
                { value: "daily_actual", label: "По дням / 365 или 366" },
              ]}
            >
              <SelectTrigger id="loan-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Ежемесячно (r/12)</SelectItem>
                <SelectItem value="daily_365">По дням / 365</SelectItem>
                <SelectItem value="daily_actual">По дням / 365 или 366</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {mode === "existing" && scheduleType === "annuity" ? (
            <Field>
              <FieldLabel>Известен</FieldLabel>
              <Segmented
                value={termMode}
                onChange={setTermMode}
                size="sm"
                options={[
                  { value: "term", label: "Оставшийся срок" },
                  { value: "payment", label: "Платёж" },
                ]}
              />
            </Field>
          ) : null}
          {mode === "existing" && termMode === "payment" ? (
            <Field>
              <FieldLabel htmlFor="loan-payment">Ежемесячный платёж</FieldLabel>
              <MoneyInput id="loan-payment" currency={currency} value={payment} onChange={setPayment} />
              <p className="text-xs text-muted-foreground">Оставшийся срок оценивается по месячной ставке; итог виден в предпросмотре.</p>
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="loan-months">{mode === "new" ? "Срок, месяцев" : "Осталось месяцев"}</FieldLabel>
              <Input id="loan-months" type="number" min={1} max={600} required value={months} onChange={(e) => setMonths(e.target.value)} />
            </Field>
          )}
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Начальный долг создаётся на отдельном счёте-обязательстве. Выдача денег и покупка не создаются автоматически. Старые регулярные
        расходы по этому кредиту нужно остановить, чтобы не дублировать платёж.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="justify-self-start">
        Предпросмотр графика
      </Button>
    </form>
  )
}
