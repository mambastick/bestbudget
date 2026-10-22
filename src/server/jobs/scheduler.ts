import "server-only"
import { vapidConfig } from "@/server/services/notification-settings"
import { NOTIFICATION_JOB_LOCK, withJobLock } from "./lock"
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
  const tick = () => {
    if (activeTick || stopped.signal.aborted) return
    activeTick = withJobLock(NOTIFICATION_JOB_LOCK, async () => {
      await vapidConfig()
      await runNotificationJob()
    })
      .catch(() => console.error("[jobs] scheduler failed"))
      .finally(() => {
        activeTick = undefined
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
      await Promise.allSettled([polling, activeTick])
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
