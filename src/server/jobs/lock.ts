import "server-only"
import postgres from "postgres"
import { env } from "@/lib/env"

export const NOTIFICATION_JOB_LOCK = 1
export const TELEGRAM_POLLING_LOCK = 2
export const AI_REVIEW_JOB_LOCK = 3

/** Pin one session for the entire job; service queries keep using the normal pool. */
export async function withJobLock<T>(key: number, job: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  const disconnected = new AbortController()
  let connectionLost = false
  const client = postgres(env().DATABASE_URL, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 0,
    max_lifetime: 0,
    onnotice: () => {},
    onclose: () => {
      connectionLost = true
      disconnected.abort()
    },
  })

  try {
    const session = await client.reserve()
    try {
      const [row] = await session<{ acquired: boolean }[]>`
        select pg_try_advisory_lock(208476, ${key}) as acquired
      `
      if (!row?.acquired) return
      try {
        return await job(disconnected.signal)
      } finally {
        // A disconnected session already lost its lock. Never reconnect to unlock it.
        if (!connectionLost) {
          await session`select pg_advisory_unlock(208476, ${key})`
        }
      }
    } finally {
      session.release()
    }
  } finally {
    await client.end({ timeout: 5 })
  }
}
