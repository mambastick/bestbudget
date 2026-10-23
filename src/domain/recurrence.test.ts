import { describe, expect, it } from "vitest"
import { describeSchedule, occurrencesBetween, type Schedule } from "./recurrence"

const monthly = (day: number, startDate: string, endDate: string | null = null, interval = 1): Schedule => ({
  frequency: "monthly",
  interval,
  dayOfMonth: day,
  startDate,
  endDate,
})

describe("occurrencesBetween", () => {
  it("generates monthly salary on a fixed day", () => {
    expect(occurrencesBetween(monthly(5, "2026-01-01"), "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-05",
      "2026-02-05",
      "2026-03-05",
      "2026-04-05",
    ])
  })

  it("clamps day 31 to the end of short months without drifting", () => {
    expect(occurrencesBetween(monthly(31, "2026-01-31"), "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ])
  })

  it("handles days 29 and 30 in February, including leap years", () => {
    expect(occurrencesBetween(monthly(29, "2027-12-01"), "2028-01-01", "2028-03-31")).toEqual([
      "2028-01-29",
      "2028-02-29",
      "2028-03-29",
    ])
    expect(occurrencesBetween(monthly(30, "2026-01-01"), "2026-02-01", "2026-03-31")).toEqual(["2026-02-28", "2026-03-30"])
  })

  it("does not emit a monthly occurrence before the start date", () => {
    // Starts on the 10th, pays on the 5th: first payment is next month.
    expect(occurrencesBetween(monthly(5, "2026-01-10"), "2026-01-01", "2026-02-28")).toEqual(["2026-02-05"])
  })

  it("stops temporary income after the end date", () => {
    // 30 000 monthly from January to June.
    const dates = occurrencesBetween(monthly(15, "2026-01-01", "2026-06-30"), "2026-01-01", "2026-12-31")
    expect(dates).toHaveLength(6)
    expect(dates.at(-1)).toBe("2026-06-15")
  })

  it("supports intervals (every 2 months, every 2 weeks)", () => {
    expect(occurrencesBetween(monthly(1, "2026-01-01", null, 2), "2026-01-01", "2026-07-31")).toEqual([
      "2026-01-01",
      "2026-03-01",
      "2026-05-01",
      "2026-07-01",
    ])
    const biweekly: Schedule = { frequency: "weekly", interval: 2, dayOfMonth: null, startDate: "2026-01-02", endDate: null }
    expect(occurrencesBetween(biweekly, "2026-01-10", "2026-02-15")).toEqual(["2026-01-16", "2026-01-30", "2026-02-13"])
  })

  it("aligns weekly occurrences to the start weekday when the window starts mid-cycle", () => {
    const weekly: Schedule = { frequency: "weekly", interval: 1, dayOfMonth: null, startDate: "2026-11-02", endDate: null }
    expect(occurrencesBetween(weekly, "2026-11-04", "2026-11-20")).toEqual(["2026-11-09", "2026-11-16"])
  })

  it("generates daily occurrences", () => {
    const daily: Schedule = { frequency: "daily", interval: 1, dayOfMonth: null, startDate: "2026-02-27", endDate: "2026-03-02" }
    expect(occurrencesBetween(daily, "2026-01-01", "2026-12-31")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"])
  })

  it("moves yearly Feb 29 to Feb 28 in non-leap years", () => {
    const yearly: Schedule = { frequency: "yearly", interval: 1, dayOfMonth: null, startDate: "2028-02-29", endDate: null }
    expect(occurrencesBetween(yearly, "2028-01-01", "2030-12-31")).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"])
  })

  it("returns the single date for one-off schedules only when in range", () => {
    const once: Schedule = { frequency: "once", interval: 1, dayOfMonth: null, startDate: "2026-11-05", endDate: null }
    expect(occurrencesBetween(once, "2026-11-01", "2026-11-30")).toEqual(["2026-11-05"])
    expect(occurrencesBetween(once, "2026-12-01", "2026-12-31")).toEqual([])
  })

  it("is deterministic for overlapping windows (the basis of idempotent generation)", () => {
    const s = monthly(20, "2026-01-01")
    const a = occurrencesBetween(s, "2026-01-01", "2026-06-30")
    const b = [...occurrencesBetween(s, "2026-01-01", "2026-03-31"), ...occurrencesBetween(s, "2026-04-01", "2026-06-30")]
    expect(b).toEqual(a)
  })
})

describe("describeSchedule", () => {
  it("describes common schedules in Russian", () => {
    expect(describeSchedule(monthly(5, "2026-01-01"))).toBe("Ежемесячно, 5-го числа")
    expect(describeSchedule({ frequency: "weekly", interval: 1, dayOfMonth: null, startDate: "2026-11-02" })).toBe(
      "Еженедельно, в понедельник",
    )
    expect(describeSchedule({ frequency: "yearly", interval: 1, dayOfMonth: 14, startDate: "2026-02-14" })).toBe(
      "Ежегодно, 14 февраля",
    )
  })
})


describe("localized schedules", () => {
  it("uses English dates and complete interval phrases", () => {
    expect(describeSchedule(monthly(5, "2026-01-01"), "en")).toBe("Monthly on day 5")
    expect(describeSchedule({ ...monthly(31, "2026-02-01"), frequency: "yearly", interval: 2 }, "en")).toBe("Every 2 years on February 31")
    expect(describeSchedule({ ...monthly(5, "2026-11-02"), frequency: "weekly", interval: 2 }, "en")).toBe("Every 2 weeks on Monday")
    expect(describeSchedule({ ...monthly(5, "2026-01-01"), frequency: "daily", interval: 21 }, "en")).toBe("Every 21 days")
  })
  it.each([[1, "Ежедневно"], [2, "Каждые 2 дня"], [5, "Каждые 5 дней"], [21, "Каждый 21 день"]])("keeps ICU interval %s distinct from a daily schedule", (interval, expected) => {
    expect(describeSchedule({ ...monthly(5, "2026-01-01"), frequency: "daily", interval: Number(interval) }, "ru")).toBe(expected)
  })
})
