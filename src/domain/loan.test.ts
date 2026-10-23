import { describe, expect, it } from "vitest"
import { annuityPayment, calculateLoanSchedule, termForPayment, type LoanParameters } from "./loan"

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
