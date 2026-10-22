import { describe, expect, it } from "vitest"
import { backupConfig } from "./config"
import { backupHealthy, backupTimestamp, expiredBackups, localDay, nextDailyRun, type BackupFile } from "./policy"

function file(day: string): BackupFile {
  return { name: `bestbudget-${day}T030000Z-v1.0.0-beta.1.dump`, createdAt: backupTimestamp(`bestbudget-${day}T030000Z.dump`)!, size: 123 }
}

describe("backup retention", () => {
  it("keeps both recent days and the newest count, including older copies", () => {
    const files = [file("20260101"), file("20260102"), file("20261020"), file("20261021"), file("20261022")]
    expect(expiredBackups(files, 2, 30, new Date("2026-10-23T03:00:00Z")).map((item) => item.name)).toEqual([files[1]!.name, files[0]!.name])
    expect(expiredBackups(files, 2, 0, new Date("2026-11-23T03:00:00Z"))).toHaveLength(3)
    expect(expiredBackups(files, 2, 0, new Date("2026-11-23T03:00:00Z"), [files[0]!.name])).toHaveLength(2)
  })
  it("ignores malformed, impossible, multiline and unrelated names", () => {
    for (const name of ["notes.dump", "bestbudget-20260230T030000Z.dump", "bestbudget-20260101T030000Z.dump\n", "../bestbudget-20260101T030000Z.dump", "bestbudget-20260101T030000Z.dump.partial"]) expect(backupTimestamp(name)).toBeNull()
  })
})

describe("local daily schedule", () => {
  it("uses Moscow local time and crosses the UTC date boundary", () => {
    expect(nextDailyRun(new Date("2026-10-22T23:59:00Z"), "03:00", "Europe/Moscow").toISOString()).toBe("2026-10-23T00:00:00.000Z")
    expect(nextDailyRun(new Date("2026-10-23T00:00:00Z"), "03:00", "Europe/Moscow").toISOString()).toBe("2026-10-24T00:00:00.000Z")
  })
  it("skips a DST gap and runs only once during a repeated local day", () => {
    expect(nextDailyRun(new Date("2026-03-29T00:00:00Z"), "02:30", "Europe/Berlin").toISOString()).toBe("2026-03-30T00:30:00.000Z")
    const first = nextDailyRun(new Date("2026-10-25T00:00:00Z"), "02:30", "Europe/Berlin")
    expect(first.toISOString()).toBe("2026-10-25T00:30:00.000Z")
    expect(nextDailyRun(first, "02:30", "Europe/Berlin", localDay(first, "Europe/Berlin")).toISOString()).toBe("2026-10-26T01:30:00.000Z")
  })
  it("rejects invalid settings without including credential values in errors", () => {
    expect(() => backupConfig({ ...process.env, BACKUP_TIME: "25:00", AWS_SECRET_ACCESS_KEY: "private-key" })).toThrow("BACKUP_TIME")
    expect(() => backupConfig({ ...process.env, TZ: "invalid/zone" })).toThrow("TZ")
    expect(() => backupConfig({ ...process.env, BACKUP_KEEP_LAST: "0" })).toThrow("BACKUP_KEEP_LAST")
  })
})

describe("backup freshness", () => {
  const now = new Date("2026-10-23T05:00:00Z")
  it("becomes unhealthy after 26 hours, even after a process restart", () => {
    expect(backupHealthy(file("20261022"), "2026-10-24T00:00:00Z", now)).toBe(false)
    expect(backupHealthy(file("20261023"), undefined, now)).toBe(true)
  })
  it("allows only the first future window for an empty directory", () => {
    expect(backupHealthy(undefined, "2026-10-24T00:00:00Z", now)).toBe(true)
    expect(backupHealthy(undefined, "2026-10-23T00:00:00Z", now)).toBe(false)
    expect(backupHealthy(undefined, undefined, now)).toBe(false)
  })
})
