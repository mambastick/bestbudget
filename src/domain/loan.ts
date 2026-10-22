import { addDays, addMonths, daysInMonth, diffDays, isIsoDate, makeDate, ymd } from "@/lib/dates"

export type PrepaymentMode = "reduce_term" | "reduce_payment"
export type LoanEventInput =
  | { type: "prepayment"; date: string; amount: number; mode: PrepaymentMode }
  | { type: "rate_change"; date: string; annualRate: string }
  | { type: "reconciliation"; date: string; balance: number }

export interface LoanParameters {
  trackingBalance: number
  annualRate: string
  trackingDate: string
  firstPaymentDate: string
  termMonths: number
  paymentDay: number
  paymentAmount?: number | null
  scheduleType: "annuity" | "differentiated"
  interestMethod: "monthly" | "daily_365" | "daily_actual"
}

export interface LoanPayment {
  dueDate: string
  principal: number
  interest: number
}

export interface LoanScheduleRow {
  n: number
  date: string
  payment: number
  interest: number
  principal: number
  balance: number
  kind: "scheduled" | "prepayment" | "reconciliation"
}

export class LoanCalculationError extends Error {}

const RATE_SCALE = 1_000_000n
const safeMoney = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000_000_000

function rateUnits(rate: string): bigint {
  if (!/^\d{1,3}(\.\d{1,6})?$/.test(rate)) throw new LoanCalculationError("Ставка должна быть от 0 до 100%, до 6 знаков после запятой")
  const [whole = "0", fraction = ""] = rate.split(".")
  const units = BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(6, "0"))
  if (units > 100n * RATE_SCALE) throw new LoanCalculationError("Ставка должна быть от 0 до 100%")
  return units
}

function rounded(n: bigint, d: bigint): number {
  const value = Number((n + d / 2n) / d)
  if (!safeMoney(value)) throw new LoanCalculationError("Слишком большая сумма")
  return value
}

/** Exact rational annuity, rounded half-up to a minor unit; no floating-point money. */
export function annuityPayment(principal: number, annualRate: string, months: number): number {
  if (!safeMoney(principal) || !Number.isInteger(months) || months < 1 || months > 600)
    throw new LoanCalculationError("Некорректная сумма или срок")
  const numerator = rateUnits(annualRate)
  if (numerator === 0n) return rounded(BigInt(principal), BigInt(months))
  const denominator = 1200n * RATE_SCALE
  const power = (denominator + numerator) ** BigInt(months)
  return rounded(BigInt(principal) * numerator * power, denominator * (power - denominator ** BigInt(months)))
}

/** Finds the remaining term without logarithms or floating-point balance arithmetic. */
export function termForPayment(principal: number, rate: string, payment: number): number {
  if (!safeMoney(principal) || !safeMoney(payment) || payment === 0) throw new LoanCalculationError("Укажите положительную сумму платежа")
  let balance = principal
  for (let n = 1; n <= 600; n++) {
    const interest = rounded(BigInt(balance) * rateUnits(rate), 1200n * RATE_SCALE)
    if (payment <= interest) throw new LoanCalculationError("Платёж не покрывает проценты")
    balance -= payment - interest
    if (balance <= 0) return n
  }
  throw new LoanCalculationError("Срок превышает 600 месяцев")
}

function dueDate(first: string, offset: number, day: number) {
  if (offset === 0) return first
  const { y, m } = ymd(addMonths(first.slice(0, 8) + "01", offset))
  return makeDate(y, m, Math.min(day, daysInMonth(y, m)))
}

/** Interest is accumulated as rational fractions and rounded only once per payment period. */
function interestFraction(
  balance: number,
  rate: bigint,
  from: string,
  to: string,
  method: LoanParameters["interestMethod"],
  periodDays: number,
): [bigint, bigint] {
  if (to <= from || balance === 0) return [0n, 1n]
  const base = BigInt(balance) * rate
  if (method === "monthly") return [base * BigInt(diffDays(to, from)), 1200n * RATE_SCALE * BigInt(periodDays)]
  let n = 0n
  // A common denominator for both leap and ordinary years prevents segment-rounding drift.
  const d = 100n * RATE_SCALE * 365n * 366n
  for (let day = addDays(from, 1); day <= to; ) {
    const year = ymd(day).y
    const end = to < `${year}-12-31` ? to : `${year}-12-31`
    const leap = daysInMonth(year, 2) === 29
    const basis = method === "daily_actual" && leap ? 366n : 365n
    n += base * BigInt(diffDays(end, day) + 1) * ((365n * 366n) / basis)
    day = addDays(end, 1)
  }
  return [n, d]
}

/**
 * Calendar periods are (previous date, payment date]. Events take effect at the end of their day.
 * On a due date the scheduled payment precedes events. Posted allocations override the plan.
 * The monthly annuity is also the baseline for daily methods; the last instalment settles exactly.
 */
export function calculateLoanSchedule(
  params: LoanParameters,
  events: LoanEventInput[] = [],
  payments: LoanPayment[] = [],
): LoanScheduleRow[] {
  const p = params
  if (
    !safeMoney(p.trackingBalance) ||
    p.trackingBalance === 0 ||
    !Number.isInteger(p.termMonths) ||
    p.termMonths < 1 ||
    p.termMonths > 600 ||
    !Number.isInteger(p.paymentDay) ||
    p.paymentDay < 1 ||
    p.paymentDay > 31
  )
    throw new LoanCalculationError("Некорректная сумма, срок или день платежа")
  if (
    ![p.trackingDate, p.firstPaymentDate].every(isIsoDate) ||
    p.firstPaymentDate <= p.trackingDate ||
    p.firstPaymentDate > addDays(addMonths(p.trackingDate, 1), 31)
  )
    throw new LoanCalculationError("Проверьте дату начала учёта и первого платежа")
  if (p.paymentAmount != null && (!safeMoney(p.paymentAmount) || p.paymentAmount === 0))
    throw new LoanCalculationError("Укажите положительную сумму платежа")
  let rate = rateUnits(p.annualRate)
  let currentRate = p.annualRate
  let balance = p.trackingBalance
  let payment = p.paymentAmount ?? Math.max(1, annuityPayment(balance, currentRate, p.termMonths))
  let principalPart = Math.max(1, rounded(BigInt(balance), BigInt(p.termMonths)))
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date))
  for (const e of sorted) {
    if (!isIsoDate(e.date) || e.date < p.trackingDate || e.date > dueDate(p.firstPaymentDate, p.termMonths - 1, p.paymentDay))
      throw new LoanCalculationError("Событие за пределами срока кредита")
    if (e.type === "rate_change") rateUnits(e.annualRate)
    else if (!safeMoney(e.type === "prepayment" ? e.amount : e.balance) || (e.type === "prepayment" && e.amount === 0))
      throw new LoanCalculationError("Некорректная сумма события")
  }
  if (new Set(sorted.map((e) => e.date)).size !== sorted.length) throw new LoanCalculationError("На одну дату допустимо одно событие")
  const actual = new Map(payments.map((r) => [r.dueDate, r]))
  const out: LoanScheduleRow[] = []
  let eventIndex = 0
  let previous = p.trackingDate
  for (let i = 0; i < p.termMonths && (balance > 0 || eventIndex < sorted.length); i++) {
    const date = dueDate(p.firstPaymentDate, i, p.paymentDay)
    const days = diffDays(date, previous)
    let cursor = previous
    let fractionN = 0n
    let fractionD = 1n
    const accrue = (to: string) => {
      const [n, d] = interestFraction(balance, rate, cursor, to, p.interestMethod, days)
      fractionN = fractionN * d + n * fractionD
      fractionD *= d
      cursor = to
    }
    const applyEvent = (e: LoanEventInput, months: number) => {
      if (e.type === "rate_change") {
        currentRate = e.annualRate
        rate = rateUnits(currentRate)
      } else if (e.type === "reconciliation") {
        balance = e.balance
        out.push({ n: i + 1, date: e.date, payment: 0, principal: 0, interest: 0, balance, kind: "reconciliation" })
      } else {
        const paid = Math.min(e.amount, balance)
        balance -= paid
        out.push({ n: i + 1, date: e.date, payment: paid, principal: paid, interest: 0, balance, kind: "prepayment" })
        if (e.mode === "reduce_term") return
      }
      if (months > 0) {
        payment = balance === 0 ? 0 : Math.max(1, annuityPayment(balance, currentRate, months))
        principalPart = balance === 0 ? 0 : Math.max(1, rounded(BigInt(balance), BigInt(months)))
      }
    }
    while (sorted[eventIndex] && sorted[eventIndex]!.date < date) {
      const e = sorted[eventIndex++]!
      accrue(e.date)
      applyEvent(e, p.termMonths - i)
    }
    accrue(date)
    const interest = rounded(fractionN, fractionD)
    let body = p.scheduleType === "annuity" ? payment - interest : principalPart
    const posted = actual.get(date)
    if (posted) {
      if (!safeMoney(posted.principal) || !safeMoney(posted.interest) || posted.principal > balance)
        throw new LoanCalculationError("Подтверждённый платёж превышает остаток долга")
      body = posted.principal
    } else if (i === p.termMonths - 1) body = balance
    else if (balance > 0 && body <= 0) throw new LoanCalculationError("Платёж не покрывает проценты; увеличьте платёж или срок")
    body = Math.max(0, Math.min(body, balance))
    balance -= body
    if (body + (posted?.interest ?? interest) > 0)
      out.push({
        n: i + 1,
        date,
        payment: body + (posted?.interest ?? interest),
        interest: posted?.interest ?? interest,
        principal: body,
        balance,
        kind: "scheduled",
      })
    while (sorted[eventIndex]?.date === date) applyEvent(sorted[eventIndex++]!, p.termMonths - i - 1)
    previous = date
  }
  return out
}

export const LOAN_KIND_LABELS = {
  mortgage: "Ипотека",
  consumer: "Потребительский",
  car: "Автокредит",
  credit_line: "Кредитная линия",
  other: "Другой",
} as const
