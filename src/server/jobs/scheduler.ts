import "server-only"
import { vapidConfig } from "@/server/services/notification-settings"
import { AI_REVIEW_JOB_LOCK, NOTIFICATION_JOB_LOCK, withJobLock } from "./lock"
import { deliverReviewNotifications, runBudgetReviewJob } from "./budget-review"
import { runNotificationJob } from "./notifications"
import { runTelegramPolling } from "./telegram-polling"

interface BackgroundJobs {
  stop: () => Promise<void>
}
const state = globalThis as typeof globalThis & { __bestbudgetBackgroundJobs?: BackgroundJobs }

export function startScheduler() {
  if (state.__bestbudgetBackgroundJobs) return
  const stopped = new AbortController()
  let activeTick: Promise<void> | undefined
  let activeReview: Promise<void> | undefined
  const tick = () => {
    if (stopped.signal.aborted) return
    if (!activeTick)
      activeTick = withJobLock(NOTIFICATION_JOB_LOCK, async () => {
        await vapidConfig()
        await runNotificationJob()
      })
        .catch(() => console.error("[jobs] scheduler failed"))
        .finally(() => {
          activeTick = undefined
        })
    if (!activeReview)
      activeReview = withJobLock(AI_REVIEW_JOB_LOCK, async (signal) => {
        const abort = AbortSignal.any([signal, stopped.signal])
        await runBudgetReviewJob(new Date(), abort)
        if (!abort.aborted) await deliverReviewNotifications()
      })
        .catch(() => console.error("[jobs] budget review failed"))
        .finally(() => {
          activeReview = undefined
        })
  }
  const timer = setInterval(tick, 60_000)
  timer.unref()
  const polling = runTelegramPolling(stopped.signal)
  const shutdown = () => {
    void stopScheduler()
  }

  const jobs: BackgroundJobs = {
    stop: async () => {
      clearInterval(timer)
      stopped.abort()
      process.off("SIGTERM", shutdown)
      process.off("SIGINT", shutdown)
      await Promise.allSettled([polling, activeTick, activeReview])
      if (state.__bestbudgetBackgroundJobs === jobs) {
        state.__bestbudgetBackgroundJobs = undefined
      }
    },
  }
  state.__bestbudgetBackgroundJobs = jobs
  process.once("SIGTERM", shutdown)
  process.once("SIGINT", shutdown)
  tick()
}

export async function stopScheduler() {
  await state.__bestbudgetBackgroundJobs?.stop()
}
