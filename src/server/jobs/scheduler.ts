import "server-only"
import { vapidConfig } from "@/server/services/notification-settings"
import { withJobLock } from "./lock"
import { runNotificationJob } from "./notifications"

const state = globalThis as typeof globalThis & { __bestbudgetJobs?: NodeJS.Timeout }
export function startScheduler() {
  if (state.__bestbudgetJobs) return
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await withJobLock(1, async () => {
        await vapidConfig()
        await runNotificationJob()
      })
    } catch { console.error("[jobs] scheduler failed") }
    finally { running = false }
  }
  state.__bestbudgetJobs = setInterval(tick, 60_000)
  state.__bestbudgetJobs.unref()
  void tick()
}
