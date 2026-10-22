import "server-only"
import { setTimeout } from "node:timers/promises"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { notificationSettings } from "@/db/schema"
import { pollTelegram } from "@/server/notifications/telegram"
import { DeliveryError } from "@/server/notifications/telegram-api"
import {
  configureTelegramTransport,
  telegramConfig,
  type TelegramConfig,
} from "@/server/services/notification-settings"
import { TELEGRAM_POLLING_LOCK, withJobLock } from "./lock"

const CONFIG_CHECK_MS = 1000
const LOCK_RETRY_MS = 2000

export async function abortableDelay(ms: number, signal: AbortSignal) {
  await setTimeout(ms, undefined, { signal })
}

export function telegramConfigurationKey(config: TelegramConfig | null): string {
  return JSON.stringify([config?.token, config?.mode, config?.row.version])
}

export function pollingBackoff(error: unknown, failures: number): number {
  const exponential = Math.min(30_000, 1000 * 2 ** Math.min(failures - 1, 5))
  if (!(error instanceof DeliveryError)) return exponential
  const conflictDelay = error.code === "telegram_409" ? 5000 : 0
  return Math.max(exponential, conflictDelay, error.retryAfter * 1000)
}

interface PollingDependencies {
  readConfig: () => Promise<TelegramConfig>
  configure: (signal: AbortSignal) => Promise<TelegramConfig | null>
  poll: (config: TelegramConfig, signal: AbortSignal) => Promise<void>
  delay: typeof abortableDelay
  report: (error: unknown | null) => Promise<void>
}

const dependencies: PollingDependencies = {
  readConfig: telegramConfig,
  configure: configureTelegramTransport,
  poll: pollTelegram,
  delay: abortableDelay,
  report: async (error) => {
    const transportError = error === null ? null : error instanceof DeliveryError ? error.code : "telegram_polling"
    await getDb().update(notificationSettings).set({ transportError }).where(eq(notificationSettings.id, 1))
  },
}

/** The elected replica retains its own session while polling or waiting for configuration changes. */
export async function runPollingSession(signal: AbortSignal, deps: PollingDependencies = dependencies) {
  const stopped = new AbortController()
  const sessionSignal = AbortSignal.any([signal, stopped.signal])
  let request: AbortController | undefined
  let configurationKey: string | undefined
  let watchError: unknown
  let failures = 0

  const watchConfiguration = async () => {
    while (!sessionSignal.aborted) {
      await deps.delay(CONFIG_CHECK_MS, sessionSignal)
      const current = await deps.readConfig()
      if (configurationKey !== undefined && telegramConfigurationKey(current) !== configurationKey) {
        request?.abort()
      }
    }
  }
  const watcher = watchConfiguration().catch((error: unknown) => {
    if (sessionSignal.aborted) return
    watchError = error
    stopped.abort()
  })

  try {
    while (!sessionSignal.aborted) {
      const desired = await deps.readConfig()
      const nextKey = telegramConfigurationKey(desired)
      if (configurationKey !== nextKey) failures = 0
      configurationKey = nextKey
      request = new AbortController()
      const requestSignal = AbortSignal.any([sessionSignal, request.signal])
      try {
        if (!desired.token) {
          await deps.delay(CONFIG_CHECK_MS, requestSignal)
          continue
        }
        const configured = await deps.configure(requestSignal)
        requestSignal.throwIfAborted()
        if (telegramConfigurationKey(configured) !== configurationKey) continue
        if (!configured || configured.mode !== "polling") {
          await deps.delay(CONFIG_CHECK_MS, requestSignal)
          continue
        }

        await deps.poll(configured, requestSignal)
        await deps.report(null)
        failures = 0
        // No minute timer or sleep here: the next long poll starts immediately.
      } catch (error) {
        if (requestSignal.aborted) continue
        failures++
        await deps.report(error)
        await deps.delay(pollingBackoff(error, failures), requestSignal).catch((delayError: unknown) => {
          if (!requestSignal.aborted) throw delayError
        })
      }
    }
  } finally {
    stopped.abort()
    request?.abort()
    await watcher
  }
  if (watchError !== undefined) throw watchError
}

/** Independent from the minute notification job, including its database lock and failures. */
export async function runTelegramPolling(signal: AbortSignal) {
  let failures = 0
  while (!signal.aborted) {
    let retryDelay = LOCK_RETRY_MS
    try {
      await withJobLock(TELEGRAM_POLLING_LOCK, (sessionSignal) =>
        runPollingSession(AbortSignal.any([signal, sessionSignal])),
      )
      failures = 0
    } catch {
      if (signal.aborted) break
      failures++
      retryDelay = pollingBackoff(undefined, failures)
      console.error("[jobs] Telegram polling failed")
    }
    if (!signal.aborted) {
      await abortableDelay(retryDelay, signal).catch((error: unknown) => {
        if (!signal.aborted) throw error
      })
    }
  }
}
