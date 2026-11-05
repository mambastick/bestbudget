import { describe, expect, it } from "vitest"
import { addMonths } from "@/lib/dates"
import {
  annuityPayment,
  calculateLoanSchedule,
  LoanCalculationError,
  loanEditBoundary,
  loanEndDate,
  toLoanEventInput,
  loanSnapshot,
  loanTermsAt,
  loanTermUntil,
  nextPaymentOn,
  termForPayment,
  type LoanEventInput,
  type LoanParameters,
  type LoanScheduleRow,
} from "./loan"

const base: LoanParameters = {
  trackingBalance: 100_000_00,
  annualRate: "12",
  trackingDate: "2024-01-01",
  firstPaymentDate: "2024-02-01",
  termMonths: 12,
  paymentDay: 1,
  scheduleType: "annuity",
  interestMethod: "monthly",
}
const sum = (rows: ReturnType<typeof calculateLoanSchedule>, key: "principal" | "interest") => rows.reduce((s, r) => s + r[key], 0)

function invariant(rows: ReturnType<typeof calculateLoanSchedule>, principal: number) {
  expect(sum(rows, "principal")).toBe(principal)
  expect(rows.at(-1)?.balance).toBe(0)
  for (const r of rows) {
    for (const k of ["payment", "interest", "principal", "balance"] as const) {
      expect(Number.isSafeInteger(r[k])).toBe(true)
      expect(r[k]).toBeGreaterThanOrEqual(0)
    }
    expect(r.payment).toBe(r.principal + r.interest)
  }
}

describe("loan schedules", () => {
  it("matches the published FinPulse calculator example and exact annuity formula", () => {
    // Public calculator's default example, checked 2026-10-23:
    // https://finraz.ru/credit — 100,000 RUB, 12%, 12 months, monthly method.
    // Formula independently published at https://calc.consultant.ru/crd (calculation section).
    const rows = calculateLoanSchedule(base)
    expect(annuityPayment(base.trackingBalance, "12", 12)).toBe(8884_88)
    expect(rows[0]).toMatchObject({ payment: 8884_88, interest: 1000_00, principal: 7884_88, balance: 92115_12 })
    // Its balance retains fractional kopecks (67,984.23); our period-by-period rounding gives 67,984.22.
    expect(rows[3]).toMatchObject({ payment: 8884_88, interest: 761_08, principal: 8123_80, balance: 67984_22 })
    expect(rows).toHaveLength(12)
    invariant(rows, base.trackingBalance)
  })

  it("matches a second published calculator principal/term example", () => {
    // https://finicalc.ru/kredit/ — 1,000,000 RUB / 12 months / 12% = 88,848.79 RUB.
    expect(annuityPayment(1_000_000_00, "12", 12)).toBe(88848_79)
  })

  it.each(["annuity", "differentiated"] as const)("closes a zero-rate %s loan exactly", (scheduleType) => {
    const rows = calculateLoanSchedule({ ...base, annualRate: "0", trackingBalance: 100_00, termMonths: 3, scheduleType })
    expect(rows.map((r) => r.payment)).toEqual([3333, 3333, 3334])
    expect(sum(rows, "interest")).toBe(0)
    invariant(rows, 100_00)
  })

  it("handles a one-kopeck principal and a long zero-rate term without fractional instalments", () => {
    const rows = calculateLoanSchedule({ ...base, annualRate: "0", trackingBalance: 1, termMonths: 600 })
    expect(rows).toHaveLength(1)
    invariant(rows, 1)
  })

  it("closes a one-month loan and rounds half a minor unit up", () => {
    expect(calculateLoanSchedule({ ...base, termMonths: 1, trackingBalance: 50, annualRate: "12" })[0]).toMatchObject({
      principal: 50,
      interest: 1,
      payment: 51,
      balance: 0,
    })
  })

  it("keeps differentiated principal constant and corrects the last remainder", () => {
    const rows = calculateLoanSchedule({ ...base, scheduleType: "differentiated" })
    expect(rows[0]).toMatchObject({ principal: 8333_33, interest: 1000_00, payment: 9333_33 })
    expect(rows[1]!.payment).toBeLessThan(rows[0]!.payment)
    invariant(rows, base.trackingBalance)
  })

  it("clamps payment days without drifting after February", () => {
    const rows = calculateLoanSchedule({
      ...base,
      trackingDate: "2024-01-31",
      firstPaymentDate: "2024-02-29",
      paymentDay: 31,
      termMonths: 3,
    })
    expect(rows.map((r) => r.date)).toEqual(["2024-02-29", "2024-03-31", "2024-04-30"])
    const ordinary = calculateLoanSchedule({
      ...base,
      trackingDate: "2025-01-31",
      firstPaymentDate: "2025-02-28",
      paymentDay: 30,
      termMonths: 2,
    })
    expect(ordinary[1]!.date).toBe("2025-03-30")
  })

  it("splits actual-day interest across years with the denominator of each day", () => {
    const params = {
      ...base,
      trackingBalance: 36500_00,
      annualRate: "10",
      trackingDate: "2023-12-15",
      firstPaymentDate: "2024-01-15",
      termMonths: 1,
      interestMethod: "daily_actual" as const,
    }
    const actual = calculateLoanSchedule(params)[0]!
    // Dec 16–31: 16 * 10 RUB; Jan 1–15: 15 * (3650/366) RUB = 309.59016 RUB.
    expect(actual.interest).toBe(309_59)
    expect(calculateLoanSchedule({ ...params, interestMethod: "daily_365" })[0]!.interest).toBe(310_00)
  })

  it.each(["daily_365", "daily_actual"] as const)("counts leap day for %s", (interestMethod) => {
    const r = calculateLoanSchedule({
      ...base,
      trackingDate: "2024-02-28",
      firstPaymentDate: "2024-03-01",
      termMonths: 1,
      interestMethod,
      trackingBalance: 36600_00,
      annualRate: "10",
    })[0]!
    expect(r.interest).toBe(interestMethod === "daily_actual" ? 20_00 : 20_05)
  })

  it("reduces term at the same instalment and compares interest savings with reducing payment", () => {
    const event = { type: "prepayment" as const, date: "2024-05-01", amount: 20_000_00 }
    const original = calculateLoanSchedule(base)
    const shorter = calculateLoanSchedule(base, [{ ...event, mode: "reduce_term" }])
    const smaller = calculateLoanSchedule(base, [{ ...event, mode: "reduce_payment" }])
    expect(shorter.filter((r) => r.kind === "scheduled").length).toBeLessThan(12)
    expect(shorter.find((r) => r.date === "2024-06-01")!.payment).toBe(8884_88)
    expect(smaller.find((r) => r.date === "2024-06-01")!.payment).toBeLessThan(8884_88)
    expect(smaller.at(-1)!.date).toBe(original.at(-1)!.date)
    expect(sum(shorter, "interest")).toBeLessThan(sum(smaller, "interest"))
    expect(sum(smaller, "interest")).toBeLessThan(sum(original, "interest"))
    invariant(shorter, base.trackingBalance)
    invariant(smaller, base.trackingBalance)
  })

  it.each(["monthly", "daily_365", "daily_actual"] as const)(
    "preserves the shortened maturity across later rate/payment changes with %s",
    (interestMethod) => {
      const p = { ...base, interestMethod }
      for (const date of ["2024-05-01", "2024-05-15"]) {
        const prepayment = { type: "prepayment" as const, date, amount: 20_000_00, mode: "reduce_term" as const }
        const shorter = calculateLoanSchedule(p, [prepayment])
        const changedRate = calculateLoanSchedule(p, [prepayment, { type: "rate_change", date: "2024-07-01", annualRate: "6" }])
        const changedPayment = calculateLoanSchedule(p, [
          prepayment,
          { type: "prepayment", date: "2024-07-01", amount: 1000_00, mode: "reduce_payment" },
        ])
        expect(changedRate.at(-1)!.date).toBe(shorter.at(-1)!.date)
        expect(changedPayment.at(-1)!.date).toBe(shorter.at(-1)!.date)
        invariant(changedRate, p.trackingBalance)
        invariant(changedPayment, p.trackingBalance)
      }
    },
  )

  it.each(["monthly", "daily_365", "daily_actual"] as const)(
    "preserves maturity after extra actual principal and a later rate change with %s",
    (interestMethod) => {
      const p = { ...base, interestMethod }
      const paid = [{ dueDate: p.firstPaymentDate, principal: 20_000_00, interest: 1000_00 }]
      const shorter = calculateLoanSchedule(p, [], paid)
      const changed = calculateLoanSchedule(p, [{ type: "rate_change", date: "2024-07-01", annualRate: "6" }], paid)
      expect(changed.at(-1)!.date).toBe(shorter.at(-1)!.date)
      invariant(changed, p.trackingBalance)
    },
  )

  it("caps an oversized prepayment and still settles accrued interest", () => {
    const rows = calculateLoanSchedule(base, [{ type: "prepayment", date: "2024-01-16", amount: 200_000_00, mode: "reduce_term" }])
    expect(rows[0]).toMatchObject({ principal: 100_000_00, balance: 0 })
    expect(rows[1]).toMatchObject({ principal: 0, interest: 483_87, balance: 0 })
    invariant(rows, base.trackingBalance)
  })

  it("applies a mid-period rate change without rounding each rate segment", () => {
    const rows = calculateLoanSchedule(base, [{ type: "rate_change", date: "2024-01-16", annualRate: "24" }])
    expect(rows[0]!.interest).toBe(1516_13)
    expect(rows[0]!.payment).toBeGreaterThan(8884_88)
    invariant(rows, base.trackingBalance)
  })

  it("uses a reconciled balance for all later payments", () => {
    const rows = calculateLoanSchedule(base, [{ type: "reconciliation", date: "2024-03-01", balance: 50_000_00 }])
    expect(rows.find((r) => r.date === "2024-04-01")!.interest).toBe(500_00)
    expect(rows.at(-1)!.balance).toBe(0)
  })

  it("preserves actual allocations and recalculates the remaining principal", () => {
    const rows = calculateLoanSchedule(base, [], [{ dueDate: "2024-02-01", principal: 20_000_00, interest: 900_00 }])
    expect(rows[0]).toMatchObject({ principal: 20_000_00, interest: 900_00, balance: 80_000_00 })
    expect(rows[1]!.interest).toBe(800_00)
    invariant(rows, base.trackingBalance)
  })

  it("derives remaining term for an existing loan and rejects non-amortizing payments", () => {
    expect(termForPayment(base.trackingBalance, "12", 8884_88)).toBe(12)
    expect(termForPayment(100_00, "0", 3333)).toBe(4)
    expect(() => termForPayment(base.trackingBalance, "12", 1000_00)).toThrow("не покрывает")
  })

  it.each(["monthly", "daily_365", "daily_actual"] as const)(
    "preserves integer invariants across long %s schedules and event sequences",
    (interestMethod) => {
      const p = { ...base, trackingBalance: 12_345_678_90, annualRate: "9.123456", termMonths: 360, interestMethod }
      invariant(
        calculateLoanSchedule(p, [
          { type: "prepayment", date: "2025-05-20", amount: 1_000_000_00, mode: "reduce_term" },
          { type: "rate_change", date: "2026-03-01", annualRate: "10.2" },
        ]),
        p.trackingBalance,
      )
    },
  )

  it("rejects invalid dates, rates, money and event order ambiguity", () => {
    expect(() => calculateLoanSchedule({ ...base, annualRate: "NaN" })).toThrow()
    expect(() => calculateLoanSchedule({ ...base, trackingBalance: 1.5 })).toThrow()
    expect(() => calculateLoanSchedule({ ...base, firstPaymentDate: "2024-02-30" })).toThrow()
    expect(() => calculateLoanSchedule({ ...base, termMonths: 0 })).toThrow()
    expect(() => calculateLoanSchedule(base, [{ type: "prepayment", date: "2023-01-01", amount: 100, mode: "reduce_term" }])).toThrow()
    expect(() =>
      calculateLoanSchedule(base, [
        { type: "rate_change", date: "2024-05-01", annualRate: "5" },
        { type: "reconciliation", date: "2024-05-01", balance: 10 },
      ]),
    ).toThrow()
  })
})

describe("loan terms and holidays", () => {
  const terms = {
    annualRate: "12",
    paymentDay: 1,
    scheduleType: "annuity" as const,
    interestMethod: "monthly" as const,
  }
  const scheduled = (rows: LoanScheduleRow[]) => rows.filter((r) => r.kind === "scheduled")
  const posted = (rows: LoanScheduleRow[], count: number) =>
    scheduled(rows)
      .slice(0, count)
      .map((r) => ({ dueDate: r.date, principal: r.principal, interest: r.interest }))
  /** Every kopeck of debt is repaid and every row stays a whole, non-negative amount. */
  function settles(rows: LoanScheduleRow[], opening: number) {
    for (const r of rows) {
      for (const k of ["payment", "interest", "principal", "balance"] as const) {
        expect(Number.isSafeInteger(r[k])).toBe(true)
        expect(r[k]).toBeGreaterThanOrEqual(0)
      }
      expect(r.payment).toBe(r.principal + r.interest)
    }
    const capitalized = rows.filter((r) => r.kind === "capitalization").reduce((s, r) => s + r.accrued!, 0)
    expect(sum(rows, "principal")).toBe(opening + capitalized)
    expect(rows.at(-1)?.balance).toBe(0)
  }

  describe("new terms", () => {
    it("continues exactly like a fresh loan when the change falls on a due date", () => {
      const plan = calculateLoanSchedule(base)
      const paid = posted(plan, 3)
      const boundary = paid.at(-1)!.dueDate
      const left = scheduled(plan)[2]!.balance
      const rows = calculateLoanSchedule(
        base,
        [{ type: "correction", date: boundary, ...terms, annualRate: "9", nextPaymentDate: "2024-05-01", termMonths: 24 }],
        paid,
      )
      const fresh = calculateLoanSchedule({
        ...base,
        trackingBalance: left,
        annualRate: "9",
        trackingDate: boundary,
        firstPaymentDate: "2024-05-01",
        termMonths: 24,
      })
      expect(rows.slice(0, 3)).toEqual(plan.slice(0, 3))
      expect(rows.slice(3).map(({ n: _n, ...r }) => r)).toEqual(fresh.map(({ n: _n, ...r }) => r))
      expect(rows.at(-1)?.date).toBe("2026-04-01")
      settles(rows, base.trackingBalance)
    })

    it("moves the payment day and charges interest for the actually longer period", () => {
      const plan = calculateLoanSchedule(base)
      const paid = posted(plan, 2)
      const rows = calculateLoanSchedule(
        base,
        [{ type: "correction", date: paid[1]!.dueDate, ...terms, paymentDay: 20, nextPaymentDate: "2024-04-20", termMonths: 10 }],
        paid,
      )
      const after = scheduled(rows).slice(2)
      expect(after.map((r) => r.date).slice(0, 3)).toEqual(["2024-04-20", "2024-05-20", "2024-06-20"])
      // 1 March to 20 April at r/12 per month of 31 days: 50 / 31 of a month of interest.
      const balance = scheduled(rows)[1]!.balance
      expect(after[0]!.interest).toBe(Math.round((balance * 0.01 * 50) / 31))
      settles(rows, base.trackingBalance)
    })

    it("keeps a contract payment fixed and pays off once it covers the balance", () => {
      const rows = calculateLoanSchedule(base, [
        { type: "correction", date: "2024-01-02", ...terms, nextPaymentDate: "2024-02-01", termMonths: 60, paymentAmount: 10_000_00 },
      ])
      expect(scheduled(rows)[0]!.payment).toBe(10_000_00)
      expect(scheduled(rows).length).toBeLessThan(13)
      settles(rows, base.trackingBalance)
    })

    it("restates the balance on a restructuring, keeps prior rows and records it in the schedule", () => {
      const plan = calculateLoanSchedule(base)
      const paid = posted(plan, 2)
      const rows = calculateLoanSchedule(
        base,
        [
          {
            type: "restructuring",
            date: "2024-03-15",
            balance: 90_000_00,
            ...terms,
            annualRate: "15",
            nextPaymentDate: "2024-04-15",
            paymentDay: 15,
            termMonths: 36,
          },
        ],
        paid,
      )
      expect(rows.slice(0, 2)).toEqual(plan.slice(0, 2))
      const marker = rows.find((r) => r.kind === "restructuring")!
      expect(marker).toMatchObject({ date: "2024-03-15", balance: 90_000_00, payment: 0 })
      const next = scheduled(rows)[2]!
      expect(next.date).toBe("2024-04-15")
      // Days 1–15 March accrue on the old balance and rate; the rest of the period on the new ones.
      const oldBalance = plan[1]!.balance
      const oldPart = (oldBalance * 0.01 * 14) / 31
      const newPart = (90_000_00 * 0.0125 * 31) / 31
      expect(next.interest).toBe(Math.round(oldPart + newPart))
      expect(rows.at(-1)?.balance).toBe(0)
      expect(sum(scheduled(rows).slice(2), "principal")).toBe(90_000_00)
    })

    it("switches schedule type and interest method from the change onwards", () => {
      const rows = calculateLoanSchedule(base, [
        {
          type: "restructuring",
          date: "2024-01-01",
          ...terms,
          nextPaymentDate: "2024-02-01",
          termMonths: 4,
          scheduleType: "differentiated",
          interestMethod: "daily_365",
        },
      ])
      expect(scheduled(rows).map((r) => r.principal)).toEqual([25_000_00, 25_000_00, 25_000_00, 25_000_00])
      // 31 days of January on 100 000 at 12%, by the actual-day method.
      expect(scheduled(rows)[0]!.interest).toBe(Math.round((100_000_00 * 0.12 * 31) / 365))
      settles(rows, base.trackingBalance)
    })

    it("rejects a next payment that does not follow the change", () => {
      const change = { type: "correction" as const, date: "2024-03-01", ...terms, termMonths: 6 }
      expect(() => calculateLoanSchedule(base, [{ ...change, nextPaymentDate: "2024-03-01" }])).toThrow(LoanCalculationError)
      expect(() => calculateLoanSchedule(base, [{ ...change, nextPaymentDate: "2025-05-01" }])).toThrow(LoanCalculationError)
    })

    it("applies a dated contract rate change only from its date", () => {
      const plan = calculateLoanSchedule(base)
      const rows = calculateLoanSchedule(base, [{ type: "rate_change", date: "2024-07-01", annualRate: "18" }])
      expect(rows.slice(0, 6)).toEqual(plan.slice(0, 6))
      expect(rows[6]!.interest).toBe(Math.round((rows[5]!.balance * 18) / 1200))
      settles(rows, base.trackingBalance)
    })
  })

  describe("holidays", () => {
    const holiday = {
      type: "holiday" as const,
      date: "2024-04-01",
      endDate: "2024-06-30",
      mode: "no_payment" as const,
      interest: "deferred_end" as const,
      shift: "extend_term" as const,
    }
    const plan = calculateLoanSchedule(base)

    it("skips every payment in the period, including one due on its first day", () => {
      const rows = calculateLoanSchedule(base, [holiday])
      expect(rows.filter((r) => r.kind === "holiday").map((r) => r.date)).toEqual(["2024-04-01", "2024-05-01", "2024-06-01"])
      expect(scheduled(rows).find((r) => r.date >= "2024-04-01")!.date).toBe("2024-07-01")
    })

    it("defers interest to the end at the same payment, without interest on interest", () => {
      const rows = calculateLoanSchedule(base, [holiday])
      const skipped = rows.filter((r) => r.kind === "holiday")
      const balance = plan[1]!.balance
      expect(skipped.map((r) => r.accrued)).toEqual([balance * 0.01, balance * 0.01, balance * 0.01].map(Math.round))
      expect(skipped.every((r) => r.balance === balance)).toBe(true)
      const accrued = skipped.reduce((s, r) => s + r.accrued!, 0)
      // The remaining ten payments keep their exact amounts, three months later.
      const resumed = scheduled(rows).slice(2, 12)
      expect(resumed.map((r) => r.payment)).toEqual(plan.slice(2).map((r) => r.payment))
      expect(resumed.map((r) => r.date)).toEqual(plan.slice(2).map((r) => addMonths(r.date, 3)))
      // Then the accrued interest follows in instalments of that same payment.
      const tail = scheduled(rows).slice(12)
      expect(tail.every((r) => r.principal === 0)).toBe(true)
      expect(sum(tail, "interest")).toBe(accrued)
      expect(tail[0]!.payment).toBe(Math.min(accrued, plan.at(-1)!.payment))
      settles(rows, base.trackingBalance)
    })

    it("spreads deferred interest over the remaining payments", () => {
      const rows = calculateLoanSchedule(base, [{ ...holiday, interest: "deferred_spread" }])
      const skipped = rows.filter((r) => r.kind === "holiday").reduce((s, r) => s + r.accrued!, 0)
      const resumed = scheduled(rows).slice(2)
      expect(resumed).toHaveLength(10)
      expect(resumed.at(-1)!.date).toBe(addMonths(plan.at(-1)!.date, 3))
      expect(sum(resumed, "interest") - sum(plan.slice(2), "interest")).toBe(skipped)
      expect(resumed[0]!.payment - plan[2]!.payment).toBe(Math.round(skipped / 10))
      settles(rows, base.trackingBalance)
    })

    it("capitalizes interest at the end of the period and recalculates the payment", () => {
      const rows = calculateLoanSchedule(base, [{ ...holiday, interest: "capitalize" }])
      const skipped = rows.filter((r) => r.kind === "holiday").reduce((s, r) => s + r.accrued!, 0)
      const row = rows.find((r) => r.kind === "capitalization")!
      expect(row).toMatchObject({ date: "2024-06-30", accrued: skipped, balance: plan[1]!.balance + skipped })
      const resumed = scheduled(rows).slice(2)
      expect(resumed).toHaveLength(10)
      expect(resumed[1]!.payment).toBe(annuityPayment(row.balance, "12", 10))
      settles(rows, base.trackingBalance)
    })

    it("charges nothing inside a waived period but collects interest earned before it", () => {
      const rows = calculateLoanSchedule(base, [{ ...holiday, interest: "waived" }])
      const balance = plan[1]!.balance
      expect(rows.filter((r) => r.kind === "holiday").map((r) => r.accrued)).toEqual([Math.round(balance * 0.01), 0, 0])
      const resumed = scheduled(rows).slice(2)
      expect(resumed).toHaveLength(10)
      // March's interest, carried, plus the single day between the end of the period and 1 July.
      expect(resumed[0]!.interest).toBe(Math.round(balance * 0.01) + Math.round((balance * 0.01) / 30))
      settles(rows, base.trackingBalance)
    })

    it("keeps the end date by raising the payment when asked to", () => {
      const rows = calculateLoanSchedule(base, [{ ...holiday, shift: "keep_term" }])
      expect(rows.at(-1)!.date).toBe(plan.at(-1)!.date)
      const resumed = scheduled(rows).slice(2)
      expect(resumed).toHaveLength(7)
      expect(resumed[0]!.principal).toBeGreaterThan(plan[2]!.principal)
      // Deferred interest settles with the last payment when the end date cannot move.
      const accrued = rows.filter((r) => r.kind === "holiday").reduce((s, r) => s + r.accrued!, 0)
      expect(resumed.at(-1)!.interest).toBeGreaterThanOrEqual(accrued)
      settles(rows, base.trackingBalance)
    })

    it("collects only interest in an interest-only period and freezes the body", () => {
      const rows = calculateLoanSchedule(base, [{ ...holiday, mode: "interest_only", interest: null }])
      const during = scheduled(rows).slice(2, 5)
      expect(during.every((r) => r.principal === 0 && r.payment === r.interest)).toBe(true)
      expect(during.every((r) => r.balance === plan[1]!.balance)).toBe(true)
      expect(scheduled(rows).slice(5).map((r) => r.payment)).toEqual(plan.slice(2).map((r) => r.payment))
      expect(rows.some((r) => r.kind === "holiday")).toBe(false)
      settles(rows, base.trackingBalance)
    })

    it("respects posted payments after a holiday and settles deferred interest paid with them", () => {
      const once = calculateLoanSchedule(base, [{ ...holiday, interest: "deferred_spread" }])
      const first = scheduled(once)[2]!
      const rows = calculateLoanSchedule(base, [{ ...holiday, interest: "deferred_spread" }], [
        ...posted(plan, 2),
        { dueDate: first.date, principal: first.principal, interest: first.interest },
      ])
      expect(sum(scheduled(rows).slice(2), "interest")).toBe(sum(scheduled(once).slice(2), "interest"))
      settles(rows, base.trackingBalance)
    })

    it("shortens the term after a prepayment during the holiday and still settles", () => {
      const rows = calculateLoanSchedule(base, [holiday, { type: "prepayment", date: "2024-05-10", amount: 20_000_00, mode: "reduce_term" }])
      expect(scheduled(rows).length).toBeLessThan(scheduled(calculateLoanSchedule(base, [holiday])).length)
      settles(rows, base.trackingBalance)
    })

    it("recalculates for the payable months when the rate changes during a holiday", () => {
      const rows = calculateLoanSchedule(base, [holiday, { type: "rate_change", date: "2024-05-10", annualRate: "6" }])
      const resumed = scheduled(rows).filter((r) => r.principal > 0).slice(2)
      expect(resumed).toHaveLength(10)
      expect(resumed[0]!.payment).toBe(annuityPayment(plan[1]!.balance, "6", 10))
      settles(rows, base.trackingBalance)
    })

    it("rejects periods without a payment, overlaps, posted slots and same-day changes", () => {
      expect(() => calculateLoanSchedule(base, [{ ...holiday, date: "2024-04-02", endDate: "2024-04-20" }])).toThrow(LoanCalculationError)
      expect(() => calculateLoanSchedule(base, [{ ...holiday, endDate: "2025-06-30", shift: "keep_term" }])).toThrow(LoanCalculationError)
      expect(() => calculateLoanSchedule(base, [holiday, { ...holiday, date: "2024-05-01" }])).toThrow(LoanCalculationError)
      expect(() =>
        calculateLoanSchedule(base, [holiday, { type: "correction", date: "2024-05-01", ...terms, nextPaymentDate: "2024-06-01", termMonths: 6 }]),
      ).toThrow(LoanCalculationError)
      expect(() => calculateLoanSchedule(base, [holiday], [{ dueDate: "2024-05-01", principal: 100, interest: 0 }])).toThrow(LoanCalculationError)
      expect(() => calculateLoanSchedule(base, [holiday, { type: "rate_change", date: holiday.date, annualRate: "6" }])).toThrow(LoanCalculationError)
      expect(() => calculateLoanSchedule(base, [{ ...holiday, interest: null }])).toThrow(LoanCalculationError)
      expect(() => calculateLoanSchedule(base, [{ ...holiday, endDate: "2024-03-01" }])).toThrow(LoanCalculationError)
    })
  })

  it("settles every combination of holiday options, schedule type and interest method", () => {
    for (const interestMethod of ["monthly", "daily_365", "daily_actual"] as const)
      for (const scheduleType of ["annuity", "differentiated"] as const)
        for (const shift of ["extend_term", "keep_term"] as const)
          for (const interest of ["deferred_spread", "deferred_end", "capitalize", "waived", null] as const) {
            const params = { ...base, termMonths: 24, annualRate: "17.35", paymentDay: 31, firstPaymentDate: "2024-01-31", trackingDate: "2023-12-31", interestMethod, scheduleType }
            const rows = calculateLoanSchedule(params, [
              {
                type: "holiday",
                date: "2024-03-10",
                endDate: "2024-09-09",
                mode: interest === null ? "interest_only" : "no_payment",
                interest,
                shift,
              },
            ])
            settles(rows, params.trackingBalance)
          }
  })

  describe("helpers", () => {
    it("converts between term and end date on a clamped grid", () => {
      expect(loanEndDate("2024-01-31", 2, 31)).toBe("2024-02-29")
      expect(loanTermUntil("2024-01-31", 31, "2024-02-29")).toBe(2)
      expect(loanTermUntil("2024-01-15", 15, "2024-03-14")).toBe(2)
      expect(loanTermUntil("2024-01-15", 15, "2024-03-15")).toBe(3)
      expect(loanTermUntil("2024-01-15", 15, "2024-01-14")).toBeNull()
      for (const term of [1, 7, 120, 600]) expect(loanTermUntil("2024-01-31", 31, loanEndDate("2024-01-31", term, 31))).toBe(term)
    })

    it("finds the next payment date on a given day", () => {
      expect(nextPaymentOn("2024-01-15", 20)).toBe("2024-01-20")
      expect(nextPaymentOn("2024-01-20", 20)).toBe("2024-02-20")
      expect(nextPaymentOn("2024-01-31", 31)).toBe("2024-02-29")
      expect(nextPaymentOn("2024-02-29", 31)).toBe("2024-03-31")
    })

    it("places edits after confirmed payments and events in force, but before scheduled ones", () => {
      const events: LoanEventInput[] = [
        { type: "rate_change", date: "2024-02-10", annualRate: "9" },
        { type: "rate_change", date: "2024-09-10", annualRate: "7" },
      ]
      expect(loanEditBoundary("2024-01-01", events, [], "2024-05-01")).toBe("2024-02-10")
      expect(loanEditBoundary("2024-01-01", events, [{ dueDate: "2024-03-01" }], "2024-05-01")).toBe("2024-03-01")
      expect(loanEditBoundary("2024-01-01", [], [], "2024-05-01")).toBe("2024-01-01")
      const holiday: LoanEventInput = { type: "holiday", date: "2024-04-01", endDate: "2024-06-30", mode: "no_payment", interest: "waived", shift: "extend_term" }
      expect(loanEditBoundary("2024-01-01", [holiday], [], "2024-05-01")).toBe("2024-06-30")
      expect(loanEditBoundary("2024-01-01", [holiday], [], "2024-03-01")).toBe("2024-01-01")
    })

    it("snapshots the terms around a change", () => {
      const events: LoanEventInput[] = [{ type: "correction", date: "2024-01-01", ...terms, annualRate: "6", nextPaymentDate: "2024-02-15", paymentDay: 15, termMonths: 6 }]
      const before = loanSnapshot(base, [], [], "2024-01-01")
      const after = loanSnapshot(base, events, [], "2024-01-01")
      expect(before).toMatchObject({ annualRate: "12", paymentDay: 1, nextPaymentDate: "2024-02-01", endDate: "2025-01-01", remainingPayments: 12, balance: 100_000_00 })
      expect(after).toMatchObject({ annualRate: "6", paymentDay: 15, nextPaymentDate: "2024-02-15", endDate: "2024-07-15", remainingPayments: 6 })
      expect(after.futureInterest).toBeLessThan(before.futureInterest)
      expect(loanTermsAt(base, events, "2023-12-31").annualRate).toBe("12")
    })

    it("maps stored events to calculation inputs", () => {
      const stored = {
        date: "2024-03-01",
        amount: null,
        mode: null,
        annualRate: null,
        balance: null,
        nextPaymentDate: null,
        paymentDay: null,
        termMonths: null,
        paymentAmount: null,
        scheduleType: null,
        interestMethod: null,
        endDate: null,
        holidayMode: null,
        holidayInterest: null,
        holidayShift: null,
      }
      expect(toLoanEventInput({ ...stored, type: "holiday", endDate: "2024-04-30", holidayMode: "no_payment", holidayInterest: "waived", holidayShift: "keep_term" })).toEqual({
        type: "holiday",
        date: "2024-03-01",
        endDate: "2024-04-30",
        mode: "no_payment",
        interest: "waived",
        shift: "keep_term",
      })
      expect(
        toLoanEventInput({ ...stored, type: "restructuring", annualRate: "9.5", balance: 100, nextPaymentDate: "2024-04-01", paymentDay: 1, termMonths: 6, scheduleType: "annuity", interestMethod: "monthly" }),
      ).toMatchObject({ type: "restructuring", balance: 100, termMonths: 6 })
    })
  })
})
