import "server-only"
import postgres from "postgres"
import { env } from "@/lib/env"

/** A dedicated session holds the lock; service queries keep using the normal pool (including max=1). */
export async function withJobLock<T>(key: number, job: () => Promise<T>): Promise<T | undefined> {
  const client = postgres(env().DATABASE_URL, { max: 1, onnotice: () => {} })
  try {
    const [row] = await client<{ acquired: boolean }[]>`select pg_try_advisory_lock(208476, ${key}) as acquired`
    if (!row?.acquired) return
    try {
      return await job()
    } finally {
      await client`select pg_advisory_unlock(208476, ${key})`
    }
  } finally {
    await client.end({ timeout: 5 })
  }
}
