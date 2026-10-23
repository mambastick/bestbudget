import { afterEach, expect, it, vi } from "vitest"

const jobs = vi.hoisted(() => ({
  notifications: vi.fn(async () => {}),
  polling: vi.fn(async (_signal: AbortSignal) => {}),
  vapid: vi.fn(async () => {}),
  reviews: vi.fn(async (_now: Date, _signal?: AbortSignal) => {}),
  reviewNotices: vi.fn(async () => {}),
}))
vi.mock("./budget-review", () => ({ runBudgetReviewJob: jobs.reviews, deliverReviewNotifications: jobs.reviewNotices }))
vi.mock("./notifications", () => ({ runNotificationJob: jobs.notifications }))
vi.mock("./telegram-polling", () => ({ runTelegramPolling: jobs.polling }))
vi.mock("@/server/services/notification-settings", () => ({ vapidConfig: jobs.vapid }))
vi.mock("./lock", () => ({
  NOTIFICATION_JOB_LOCK: 1,
  AI_REVIEW_JOB_LOCK: 3,
  withJobLock: async (_key: number, job: (signal: AbortSignal) => Promise<void>) => job(new AbortController().signal),
}))
import { startScheduler, stopScheduler } from "./scheduler"

afterEach(async () => {
  await stopScheduler()
  vi.useRealTimers()
  vi.clearAllMocks()
})

it("runs polling while the minute job is busy, starts only once and cleans up on shutdown", async () => {
  vi.useFakeTimers()
  const signalListeners = process.listenerCount("SIGTERM")
  let release!: () => void
  jobs.notifications.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  jobs.polling.mockImplementationOnce(
    (signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true })
      }),
  )
  startScheduler()
  startScheduler()
  await vi.advanceTimersByTimeAsync(0)
  expect(jobs.polling).toHaveBeenCalledOnce()
  expect(jobs.notifications).toHaveBeenCalledOnce()
  expect(jobs.reviews).toHaveBeenCalledOnce()
  expect(jobs.reviewNotices).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(jobs.notifications).toHaveBeenCalledOnce()
  expect(jobs.reviews).toHaveBeenCalledTimes(2)
  const stopping = stopScheduler()
  expect(jobs.polling.mock.calls[0]![0].aborted).toBe(true)
  expect(jobs.reviews.mock.calls.at(-1)![1]!.aborted).toBe(true)
  release()
  await stopping
  expect(process.listenerCount("SIGTERM")).toBe(signalListeners)
  expect(vi.getTimerCount()).toBe(0)
})
