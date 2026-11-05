import { LocalizedError } from "@/i18n/errors"
import { addDays, addMonths, daysInMonth, diffDays, isIsoDate, makeDate, ymd } from "@/lib/dates"

export type PrepaymentMode = "reduce_term" | "reduce_payment"
export type HolidayMode = "no_payment" | "interest_only"
export type HolidayInterest = "deferred_spread" | "deferred_end" | "capitalize" | "waived"
export type HolidayShift = "extend_term" | "keep_term"

/** The terms a new payment grid runs on after a correction or a restructuring. */
export interface LoanTerms {
  annualRate: string
  nextPaymentDate: string
  paymentDay: number
  termMonths: number
  /** The contract payment; computed from the term when empty. */
  paymentAmount?: number | null
  scheduleType: LoanParameters["scheduleType"]
  interestMethod: LoanParameters["interestMethod"]
}

export type LoanEventInput =
  | { type: "prepayment"; date: string; amount: number; mode: PrepaymentMode }
  | { type: "rate_change"; date: string; annualRate: string }
  | { type: "reconciliation"; date: string; balance: number }
  | ({ type: "correction"; date: string; balance?: number | null } & LoanTerms)
  | ({ type: "restructuring"; date: string; balance?: number | null } & LoanTerms)
  | {
      type: "holiday"
      date: string
      endDate: string
      mode: HolidayMode
      /** How interest accrued over the period is repaid; only for `no_payment`. */
      interest: HolidayInterest | null
      shift: HolidayShift
    }

type ScheduleStep = LoanEventInput | { type: "holiday_end"; date: string }

export type StoredLoanEvent = {
  type: LoanEventInput["type"]
  date: string
  amount: number | null
  mode: PrepaymentMode | null
  annualRate: string | null
  balance: number | null
  nextPaymentDate: string | null
  paymentDay: number | null
  termMonths: number | null
  paymentAmount: number | null
  scheduleType: LoanParameters["scheduleType"] | null
  interestMethod: LoanParameters["interestMethod"] | null
  endDate: string | null
  holidayMode: HolidayMode | null
  holidayInterest: HolidayInterest | null
  holidayShift: HolidayShift | null
}

export interface LoanTermsSnapshot {
  annualRate: string
  paymentDay: number
  scheduleType: LoanParameters["scheduleType"]
  interestMethod: LoanParameters["interestMethod"]
  nextPaymentDate: string | null
  nextPayment: number | null
  endDate: string | null
  remainingPayments: number
  balance: number
  futureInterest: number
}

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
  kind: "scheduled" | "prepayment" | "reconciliation" | "restructuring" | "holiday" | "capitalization"
  /** Interest accrued without being paid: on a skipped holiday slot, or added to the debt by capitalization. */
  accrued?: number
}

export class LoanCalculationError extends LocalizedError {}

const RATE_SCALE = 1_000_000n
// A 600-month term plus room for holidays and repayment of deferred interest.
const MAX_SCHEDULE_SLOTS = 1200
const safeMoney = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000_000_000

function rateUnits(rate: string): bigint {
  if (!/^\d{1,3}(\.\d{1,6})?$/.test(rate)) throw new LoanCalculationError("loanCalculation.rate")
  const [whole = "0", fraction = ""] = rate.split(".")
  const units = BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(6, "0"))
  if (units > 100n * RATE_SCALE) throw new LoanCalculationError("validation.loanRateRange")
  return units
}

function rounded(n: bigint, d: bigint): number {
  const value = Number((n + d / 2n) / d)
  if (!safeMoney(value)) throw new LoanCalculationError("validation.largeAmount")
  return value
}

/** Exact rational annuity, rounded half-up to a minor unit; no floating-point money. */
export function annuityPayment(principal: number, annualRate: string, months: number): number {
  if (!safeMoney(principal) || !Number.isInteger(months) || months < 1 || months > 600)
    throw new LoanCalculationError("loanCalculation.amountOrTerm")
  const numerator = rateUnits(annualRate)
  if (numerator === 0n) return rounded(BigInt(principal), BigInt(months))
  const denominator = 1200n * RATE_SCALE
  const power = (denominator + numerator) ** BigInt(months)
  return rounded(BigInt(principal) * numerator * power, denominator * (power - denominator ** BigInt(months)))
}

/** Finds the remaining term without logarithms or floating-point balance arithmetic. */
export function termForPayment(principal: number, rate: string, payment: number): number {
  if (!safeMoney(principal) || !safeMoney(payment) || payment === 0) throw new LoanCalculationError("loanCalculation.positivePayment")
  let balance = principal
  for (let n = 1; n <= 600; n++) {
    const interest = rounded(BigInt(balance) * rateUnits(rate), 1200n * RATE_SCALE)
    if (payment <= interest) throw new LoanCalculationError("loanCalculation.interest")
    balance -= payment - interest
    if (balance <= 0) return n
  }
  throw new LoanCalculationError("loanCalculation.term")
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
 * On a due date the scheduled payment precedes events, except that a holiday covers a payment due on its first day.
 * Posted allocations override the plan. The monthly annuity is also the baseline for daily methods;
 * the last instalment settles exactly. New terms replace the payment grid after their date, so earlier slots
 * and their posted allocations stay on the grid they were due on.
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
    throw new LoanCalculationError("loanCalculation.paymentDay")
  if (
    ![p.trackingDate, p.firstPaymentDate].every(isIsoDate) ||
    p.firstPaymentDate <= p.trackingDate ||
    p.firstPaymentDate > addDays(addMonths(p.trackingDate, 1), 31)
  )
    throw new LoanCalculationError("loanCalculation.trackingDate")
  if (p.paymentAmount != null && (!safeMoney(p.paymentAmount) || p.paymentAmount === 0))
    throw new LoanCalculationError("loanCalculation.positivePayment")
  let rate = rateUnits(p.annualRate)
  let currentRate = p.annualRate
  let method = p.interestMethod
  let scheduleType = p.scheduleType
  let first = p.firstPaymentDate
  let day = p.paymentDay
  let regridded = false
  let balance = p.trackingBalance
  let payment = p.paymentAmount ?? Math.max(1, annuityPayment(balance, currentRate, p.termMonths))
  let principalPart = Math.max(1, rounded(BigInt(balance), BigInt(p.termMonths)))
  let maturity = p.termMonths
  let limit = p.termMonths
  let holiday: (Extract<LoanEventInput, { type: "holiday" }> & { accrued: number }) | null = null
  // Interest accrued during a holiday, by how it is repaid afterwards.
  let carriedInterest = 0
  let spreadInterest = 0
  let endInterest = 0
  let settleEndAtLast = false
  let lastInstalment = 0

  validateEvents(p.trackingDate, events)
  const sorted: ScheduleStep[] = [
    ...events,
    ...events.flatMap((e): ScheduleStep[] => (e.type === "holiday" ? [{ type: "holiday_end", date: e.endDate }] : [])),
  ].sort((a, b) => a.date.localeCompare(b.date) || stepOrder(a) - stepOrder(b))

  const slotDate = (slot: number) => dueDate(first, slot, day)
  const periodDays = (slot: number) =>
    slot > 0
      ? diffDays(slotDate(slot), slotDate(slot - 1))
      : regridded
        ? diffDays(first, addMonths(first, -1))
        : diffDays(first, p.trackingDate)
  const accruingRate = () => (holiday?.interest === "waived" ? 0n : rate)
  const holidaySlotsFrom = (slot: number) => {
    if (!holiday) return 0
    let count = 0
    while (slotDate(slot + count) <= holiday.endDate) count++
    return count
  }
  const payableFrom = (slot: number) => Math.max(0, maturity - slot - holidaySlotsFrom(slot))
  const recompute = (nextSlot: number) => {
    const months = payableFrom(nextSlot)
    if (months > 0) {
      payment = balance === 0 ? 0 : Math.max(1, annuityPayment(balance, currentRate, months))
      principalPart = balance === 0 ? 0 : Math.max(1, rounded(BigInt(balance), BigInt(months)))
    }
  }
  // Lock in the shortened contract term, including interest already accrued in this period.
  const projectMaturity = (firstSlot: number, from: string, carryN = 0n, carryD = 1n) => {
    let rest = balance
    let previousDate = from
    for (let slot = firstSlot; slot < maturity; slot++) {
      const nextDate = slotDate(slot)
      if (holiday && nextDate <= holiday.endDate) {
        previousDate = nextDate
        carryN = 0n
        carryD = 1n
        continue
      }
      const [n, d] = interestFraction(rest, rate, previousDate, nextDate, method, periodDays(slot))
      const interest = rounded(n * carryD + carryN * d, d * carryD)
      const body = scheduleType === "annuity" ? payment - interest : principalPart
      if (rest <= Math.max(0, body)) return slot + 1
      if (body <= 0) throw new LoanCalculationError("loanCalculation.increasePayment")
      rest -= body
      previousDate = nextDate
      carryN = 0n
      carryD = 1n
    }
    return maturity
  }

  const out: LoanScheduleRow[] = []
  let eventIndex = 0
  let previous = p.trackingDate
  let i = 0
  let settledSlots = 0
  let date = ""
  let days = 0
  let cursor = ""
  let fractionN = 0n
  let fractionD = 1n
  let movedGrid: boolean
  const accrue = (to: string) => {
    const [n, d] = interestFraction(balance, accruingRate(), cursor, to, method, days)
    fractionN = fractionN * d + n * fractionD
    fractionD *= d
    cursor = to
  }
  const applyTerms = (e: Extract<LoanEventInput, { type: "correction" | "restructuring" }>) => {
    if (holiday) throw new LoanCalculationError("loanCalculation.holidayOverlap")
    if (e.balance != null) balance = e.balance
    currentRate = e.annualRate
    rate = rateUnits(currentRate)
    method = e.interestMethod
    scheduleType = e.scheduleType
    first = e.nextPaymentDate
    day = e.paymentDay
    regridded = true
    maturity = e.termMonths
    limit = e.termMonths
    payment = balance === 0 ? 0 : (e.paymentAmount ?? Math.max(1, annuityPayment(balance, currentRate, e.termMonths)))
    principalPart = balance === 0 ? 0 : Math.max(1, rounded(BigInt(balance), BigInt(e.termMonths)))
    if (e.type === "restructuring")
      out.push({ n: settledSlots + 1, date: e.date, payment: 0, principal: 0, interest: 0, balance, kind: "restructuring" })
    i = 0
    date = first
    days = periodDays(0)
    movedGrid = true
  }
  const startHoliday = (e: Extract<LoanEventInput, { type: "holiday" }>) => {
    if (holiday) throw new LoanCalculationError("loanCalculation.holidayOverlap")
    holiday = { ...e, accrued: 0 }
    const slots = holidaySlotsFrom(i)
    if (balance === 0 || slots === 0) throw new LoanCalculationError("loanCalculation.holidayEmpty")
    if (e.shift === "extend_term") {
      maturity += slots
      limit += slots
    } else if (payableFrom(i) === 0) throw new LoanCalculationError("loanCalculation.holidayTooLong")
  }
  const endHoliday = (nextSlot: number, endDate: string) => {
    const ended = holiday!
    holiday = null
    if (ended.mode === "no_payment" && ended.accrued > 0) {
      if (ended.interest === "capitalize") {
        balance += ended.accrued
        out.push({
          n: settledSlots + 1,
          date: endDate,
          payment: 0,
          principal: 0,
          interest: 0,
          balance,
          kind: "capitalization",
          accrued: ended.accrued,
        })
      } else if (ended.interest === "deferred_spread") spreadInterest += ended.accrued
      else if (ended.interest === "deferred_end") {
        endInterest += ended.accrued
        settleEndAtLast = ended.shift === "keep_term"
      } else carriedInterest += ended.accrued
    }
    if (ended.shift === "keep_term" || ended.interest === "capitalize") recompute(nextSlot)
  }
  const applyEvent = (e: ScheduleStep) => {
    const nextSlot = e.date === date ? i + 1 : i
    if (e.type === "holiday") return startHoliday(e)
    if (e.type === "holiday_end") return endHoliday(nextSlot, e.date)
    if (e.type === "correction" || e.type === "restructuring") return applyTerms(e)
    if (e.type === "rate_change") {
      currentRate = e.annualRate
      rate = rateUnits(currentRate)
    } else if (e.type === "reconciliation") {
      balance = e.balance
      // A verified residual after projected payoff resumes the remaining original contract.
      if (balance > 0 && nextSlot >= maturity) maturity = limit
      out.push({ n: settledSlots + 1, date: e.date, payment: 0, principal: 0, interest: 0, balance, kind: "reconciliation" })
    } else {
      const paid = Math.min(e.amount, balance)
      balance -= paid
      out.push({ n: settledSlots + 1, date: e.date, payment: paid, principal: paid, interest: 0, balance, kind: "prepayment" })
      if (e.mode === "reduce_term") {
        maturity = projectMaturity(nextSlot, e.date, e.date === date ? 0n : fractionN, e.date === date ? 1n : fractionD)
        return
      }
    }
    recompute(nextSlot)
  }
  const deferredShare = (slot: number) => {
    const owedInSpread = balance === 0 ? spreadInterest : rounded(BigInt(spreadInterest), BigInt(Math.max(1, payableFrom(slot))))
    const owedAtEnd =
      endInterest === 0
        ? 0
        : settleEndAtLast && slot >= maturity - 1
          ? endInterest
          : balance === 0
            ? Math.min(lastInstalment || endInterest, endInterest)
            : 0
    return carriedInterest + owedInSpread + owedAtEnd
  }
  const settleDeferred = (amount: number) => {
    const fromCarried = Math.min(amount, carriedInterest)
    carriedInterest -= fromCarried
    const fromSpread = Math.min(amount - fromCarried, spreadInterest)
    spreadInterest -= fromSpread
    endInterest -= Math.min(amount - fromCarried - fromSpread, endInterest)
  }
  // Closures assign `holiday`, so the main loop reads it through a call to avoid stale narrowing.
  const activeHoliday = () => holiday

  const actual = new Map(payments.map((r) => [r.dueDate, r]))
  while ((i < limit && (balance > 0 || eventIndex < sorted.length)) || carriedInterest + spreadInterest + endInterest > 0) {
    if (settledSlots >= MAX_SCHEDULE_SLOTS) throw new LoanCalculationError("loanCalculation.term")
    date = slotDate(i)
    days = periodDays(i)
    cursor = previous
    fractionN = 0n
    fractionD = 1n
    for (let e = sorted[eventIndex]; e && (e.date < date || (e.date === date && e.type === "holiday")); e = sorted[eventIndex]) {
      eventIndex++
      accrue(e.date)
      applyEvent(e)
    }
    accrue(date)
    const interest = rounded(fractionN, fractionD)
    const posted = actual.get(date)
    const current = activeHoliday()
    const onHoliday = current !== null && date <= current.endDate
    if (onHoliday && current.mode === "no_payment") {
      if (posted) throw new LoanCalculationError("loanCalculation.holidayPosted")
      current.accrued += interest
      out.push({ n: settledSlots + 1, date, payment: 0, principal: 0, interest: 0, balance, kind: "holiday", accrued: interest })
    } else {
      let body = onHoliday ? 0 : scheduleType === "annuity" ? payment - interest : principalPart
      const expectedPrincipal = Math.max(0, Math.min(body, balance))
      const share = onHoliday ? 0 : deferredShare(i)
      if (posted) {
        if (!safeMoney(posted.principal) || !safeMoney(posted.interest) || posted.principal > balance)
          throw new LoanCalculationError("loanCalculation.exceedsBalance")
        body = posted.principal
      } else if (!onHoliday && i === maturity - 1) body = balance
      else if (!onHoliday && balance > 0 && body <= 0) throw new LoanCalculationError("loanCalculation.increasePayment")
      body = Math.max(0, Math.min(body, balance))
      balance -= body
      const paidInterest = posted?.interest ?? interest + share
      settleDeferred(posted ? Math.max(0, posted.interest - interest) : share)
      if (body + paidInterest > 0) {
        out.push({ n: settledSlots + 1, date, payment: body + paidInterest, interest: paidInterest, principal: body, balance, kind: "scheduled" })
        lastInstalment = body + paidInterest
      }
      if (posted && posted.principal > expectedPrincipal) maturity = projectMaturity(i + 1, date)
    }
    const dueOn = date
    movedGrid = false
    while (sorted[eventIndex]?.date === dueOn) applyEvent(sorted[eventIndex++]!)
    settledSlots++
    if (!movedGrid) i++
    previous = dueOn
  }
  if (eventIndex < sorted.length) throw new LoanCalculationError("loanCalculation.eventDate")
  return out
}

/** Maps a stored event to its pure calculation input. */
export function toLoanEventInput(e: StoredLoanEvent): LoanEventInput {
  if (e.type === "rate_change") return { type: e.type, date: e.date, annualRate: e.annualRate! }
  if (e.type === "reconciliation") return { type: e.type, date: e.date, balance: e.balance! }
  if (e.type === "prepayment") return { type: e.type, date: e.date, amount: e.amount!, mode: e.mode! }
  if (e.type === "holiday")
    return { type: e.type, date: e.date, endDate: e.endDate!, mode: e.holidayMode!, interest: e.holidayInterest, shift: e.holidayShift! }
  return {
    type: e.type,
    date: e.date,
    balance: e.balance,
    annualRate: e.annualRate!,
    nextPaymentDate: e.nextPaymentDate!,
    paymentDay: e.paymentDay!,
    termMonths: e.termMonths!,
    paymentAmount: e.paymentAmount,
    scheduleType: e.scheduleType!,
    interestMethod: e.interestMethod!,
  } as LoanEventInput
}

/** The contract terms in force at the end of `at`, replayed from the initial parameters. */
export function loanTermsAt(params: LoanParameters, events: LoanEventInput[], at: string) {
  const terms = {
    annualRate: params.annualRate,
    paymentDay: params.paymentDay,
    paymentAmount: params.paymentAmount ?? null,
    scheduleType: params.scheduleType,
    interestMethod: params.interestMethod,
  }
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date) || stepOrder(a) - stepOrder(b))) {
    if (e.date > at) break
    if (e.type === "rate_change") {
      terms.annualRate = e.annualRate
      terms.paymentAmount = null
    } else if (e.type === "correction" || e.type === "restructuring") {
      terms.annualRate = e.annualRate
      terms.paymentDay = e.paymentDay
      terms.paymentAmount = e.paymentAmount ?? null
      terms.scheduleType = e.scheduleType
      terms.interestMethod = e.interestMethod
    }
  }
  return terms
}

/** What the loan looks like after `at`: stored with each change as its before and after record. */
export function loanSnapshot(
  params: LoanParameters,
  events: LoanEventInput[],
  payments: LoanPayment[],
  at: string,
): LoanTermsSnapshot {
  const rows = calculateLoanSchedule(params, events, payments)
  const terms = loanTermsAt(params, events, at)
  const upcoming = rows.filter((r) => r.kind === "scheduled" && r.date > at)
  const reached = rows.filter((r) => r.date <= at).at(-1)
  return {
    annualRate: terms.annualRate,
    paymentDay: terms.paymentDay,
    scheduleType: terms.scheduleType,
    interestMethod: terms.interestMethod,
    nextPaymentDate: upcoming[0]?.date ?? null,
    nextPayment: upcoming[0]?.payment ?? null,
    endDate: upcoming.at(-1)?.date ?? null,
    remainingPayments: upcoming.filter((r) => r.principal > 0).length,
    balance: reached?.balance ?? params.trackingBalance,
    futureInterest:
      upcoming.reduce((s, r) => s + r.interest, 0) +
      rows.filter((r) => r.kind === "capitalization" && r.date > at).reduce((s, r) => s + r.accrued!, 0),
  }
}

/**
 * Edits apply after this date, which keeps history intact: the last posted slot, the last event already in force,
 * or the end of a holiday that has already started. Later events stay scheduled and replay on top of the edit.
 */
export function loanEditBoundary(trackingDate: string, events: LoanEventInput[], payments: Pick<LoanPayment, "dueDate">[], today: string) {
  let boundary = trackingDate
  for (const e of events) {
    if (e.date > today) continue
    const until = e.type === "holiday" ? e.endDate : e.date
    if (until > boundary) boundary = until
  }
  for (const r of payments) if (r.dueDate > boundary) boundary = r.dueDate
  return boundary
}

/** The last payment date of a term on this grid. */
export function loanEndDate(nextPaymentDate: string, termMonths: number, paymentDay: number) {
  return dueDate(nextPaymentDate, termMonths - 1, paymentDay)
}

/** How many payments of this grid fall on or before `endDate`; null when none does. */
export function loanTermUntil(nextPaymentDate: string, paymentDay: number, endDate: string) {
  if (!isIsoDate(nextPaymentDate) || !isIsoDate(endDate) || endDate < nextPaymentDate) return null
  const start = ymd(nextPaymentDate)
  const end = ymd(endDate)
  const months = (end.y - start.y) * 12 + end.m - start.m + 1
  return loanEndDate(nextPaymentDate, months, paymentDay) > endDate ? months - 1 : months
}

/** The first date after `after` that falls on the payment day, clamped in short months. */
export function nextPaymentOn(after: string, paymentDay: number) {
  const { y, m } = ymd(after)
  const inMonth = makeDate(y, m, Math.min(paymentDay, daysInMonth(y, m)))
  if (inMonth > after) return inMonth
  const next = ymd(addMonths(makeDate(y, m, 1), 1))
  return makeDate(next.y, next.m, Math.min(paymentDay, daysInMonth(next.y, next.m)))
}

function validateEvents(trackingDate: string, events: LoanEventInput[]) {
  for (const e of events) {
    if (!isIsoDate(e.date) || e.date < trackingDate) throw new LoanCalculationError("loanCalculation.eventDate")
    if (e.type === "rate_change") rateUnits(e.annualRate)
    else if (e.type === "correction" || e.type === "restructuring") {
      rateUnits(e.annualRate)
      if (e.balance != null && !safeMoney(e.balance)) throw new LoanCalculationError("loanCalculation.eventAmount")
      if (
        !Number.isInteger(e.termMonths) ||
        e.termMonths < 1 ||
        e.termMonths > 600 ||
        !Number.isInteger(e.paymentDay) ||
        e.paymentDay < 1 ||
        e.paymentDay > 31
      )
        throw new LoanCalculationError("loanCalculation.paymentDay")
      if (e.paymentAmount != null && (!safeMoney(e.paymentAmount) || e.paymentAmount === 0))
        throw new LoanCalculationError("loanCalculation.positivePayment")
      if (!isIsoDate(e.nextPaymentDate) || e.nextPaymentDate <= e.date || e.nextPaymentDate > addMonths(e.date, 13))
        throw new LoanCalculationError("loanCalculation.termsDate")
    } else if (e.type === "holiday") {
      if (!isIsoDate(e.endDate) || e.endDate < e.date) throw new LoanCalculationError("loanCalculation.holidayDates")
      if ((e.mode === "no_payment") !== (e.interest !== null)) throw new LoanCalculationError("loanCalculation.holidayDates")
    } else if (!safeMoney(e.type === "prepayment" ? e.amount : e.balance) || (e.type === "prepayment" && e.amount === 0))
      throw new LoanCalculationError("loanCalculation.eventAmount")
  }
  const taken = new Set<string>()
  for (const e of events) {
    const group = e.type === "correction" || e.type === "restructuring" ? "terms" : e.type === "holiday" ? "holiday" : "ledger"
    if (taken.has(`${e.date}:${group}`)) throw new LoanCalculationError("loanCalculation.sameDate")
    taken.add(`${e.date}:${group}`)
  }
  for (const e of events)
    if (e.type === "holiday" && (taken.has(`${e.date}:terms`) || taken.has(`${e.date}:ledger`)))
      throw new LoanCalculationError("loanCalculation.sameDate")
}

/** A holiday covers a payment due on its first day; new terms apply after every other change of their day. */
function stepOrder(step: ScheduleStep) {
  if (step.type === "holiday") return 0
  if (step.type === "correction" || step.type === "restructuring") return 3
  return step.type === "holiday_end" ? 2 : 1
}

export const LOAN_KIND_LABELS = {
  mortgage: "kind.mortgage",
  consumer: "kind.consumer",
  car: "kind.car",
  credit_line: "kind.credit_line",
  other: "kind.other",
} as const
