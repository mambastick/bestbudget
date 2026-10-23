import { describe, expect, it } from "vitest"
import { dueReview, reviewSettingsInput } from "./review"

describe("budget review schedule", () => {
  it("defaults off and catches up only after the local weekday/time", () => {
    expect(dueReview(reviewSettingsInput.parse({}), "Europe/Moscow", new Date("2026-10-23T12:00:00Z"))).toBeNull()
    const weekly = reviewSettingsInput.parse({ frequency: "weekly", weekday: 5, time: "09:00" })
    expect(dueReview(weekly, "Asia/Vladivostok", new Date("2026-10-22T22:59:00Z"))).toBeNull()
    expect(dueReview(weekly, "Asia/Vladivostok", new Date("2026-10-22T23:00:00Z"))).toBe("weekly:2026-10-19")
    expect(dueReview(weekly, "America/New_York", new Date("2026-10-22T23:00:00Z"))).toBeNull()
    expect(dueReview(weekly, "Asia/Vladivostok", new Date("2026-10-24T22:00:00Z"))).toBe("weekly:2026-10-19")
  })
  it("clamps month days and uses one key across DST repeated hours", () => {
    const monthly = reviewSettingsInput.parse({ frequency: "monthly", monthDay: 31, time: "09:00" })
    expect(dueReview(monthly, "Europe/Moscow", new Date("2027-02-28T05:59:00Z"))).toBeNull()
    expect(dueReview(monthly, "Europe/Moscow", new Date("2027-02-28T06:00:00Z"))).toBe("monthly:2027-02-01")
    const weekly = reviewSettingsInput.parse({ frequency: "weekly", weekday: 7, time: "01:30" })
    expect(dueReview(weekly, "America/New_York", new Date("2026-11-01T05:30:00Z"))).toBe("weekly:2026-10-26")
    expect(dueReview(weekly, "America/New_York", new Date("2026-11-01T06:30:00Z"))).toBe("weekly:2026-10-26")
    expect(dueReview(weekly, "America/New_York", new Date("2026-11-02T07:00:00Z"))).toBeNull()
  })
})
