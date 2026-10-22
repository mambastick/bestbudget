import { beforeEach, expect, it, vi } from "vitest"

const driver = vi.hoisted(() => ({
  locks: new Set<number>(),
  sessions: [] as { queries: string[]; release: ReturnType<typeof vi.fn> }[],
  options: [] as { onclose: () => void; max_lifetime: number; idle_timeout: number }[],
  ends: [] as ReturnType<typeof vi.fn>[],
}))
vi.mock("postgres", () => ({
  default: vi.fn((_url, options) => {
    const record = { queries: [] as string[], release: vi.fn() }
    const session = Object.assign(
      vi.fn(async (strings: TemplateStringsArray, key: number) => {
        const query = strings.join("")
        record.queries.push(query)
        if (query.includes("pg_try_advisory_lock")) {
          const acquired = !driver.locks.has(key)
          if (acquired) driver.locks.add(key)
          return [{ acquired }]
        }
        driver.locks.delete(key)
        return []
      }),
      { release: record.release },
    )
    const end = vi.fn(async () => {})
    driver.sessions.push(record)
    driver.options.push(options)
    driver.ends.push(end)
    return { reserve: vi.fn(async () => session), end }
  }),
}))
import { NOTIFICATION_JOB_LOCK, TELEGRAM_POLLING_LOCK, withJobLock } from "./lock"

beforeEach(() => {
  driver.locks.clear()
  driver.sessions.length = 0
  driver.options.length = 0
  driver.ends.length = 0
})

it("holds the polling lock on one reserved session independently of the notification lock", async () => {
  let release!: () => void
  let entered!: () => void
  const acquired = new Promise<void>((resolve) => {
    entered = resolve
  })
  const polling = withJobLock(TELEGRAM_POLLING_LOCK, async () => {
    entered()
    await new Promise<void>((resolve) => {
      release = resolve
    })
  })
  await acquired
  const duplicate = vi.fn(async () => {})
  await withJobLock(TELEGRAM_POLLING_LOCK, duplicate)
  expect(duplicate).not.toHaveBeenCalled()
  const notification = vi.fn(async () => {})
  await withJobLock(NOTIFICATION_JOB_LOCK, notification)
  expect(notification).toHaveBeenCalledOnce()
  expect(driver.sessions[0]!.queries).toHaveLength(1)
  release()
  await polling
  expect(driver.sessions[0]!.queries[1]).toContain("pg_advisory_unlock")
  expect(driver.sessions.every((s) => s.release.mock.calls.length === 1)).toBe(true)
  expect(driver.ends.every((end) => end.mock.calls.length === 1)).toBe(true)
  expect(driver.options[0]).toMatchObject({ max_lifetime: 0, idle_timeout: 0 })
})

it("aborts the polling work when its lock session disconnects and does not reconnect to unlock", async () => {
  await withJobLock(TELEGRAM_POLLING_LOCK, async (signal) => {
    driver.options[0]!.onclose()
    expect(signal.aborted).toBe(true)
  })
  expect(driver.sessions[0]!.queries).toHaveLength(1)
  expect(driver.sessions[0]!.release).toHaveBeenCalledOnce()
  expect(driver.ends[0]).toHaveBeenCalledOnce()
})

it("unlocks and closes the session when the job fails", async () => {
  await expect(
    withJobLock(TELEGRAM_POLLING_LOCK, async () => {
      throw new Error("test failure")
    }),
  ).rejects.toThrow("test failure")
  expect(driver.sessions[0]!.queries[1]).toContain("pg_advisory_unlock")
  expect(driver.ends[0]).toHaveBeenCalledOnce()
})
