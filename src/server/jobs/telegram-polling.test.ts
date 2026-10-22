import { afterEach, describe, expect, it, vi } from "vitest"
import type { TelegramConfig } from "@/server/services/notification-settings"
import { DeliveryError } from "@/server/notifications/telegram-api"
import { pollingBackoff, runPollingSession } from "./telegram-polling"

function config(): TelegramConfig {
  return {
    token: "token-a",
    mode: "polling",
    secret: null,
    row: {
      id: 1,
      botTokenEncrypted: "encrypted",
      mode: "polling",
      botUsername: "test_bot",
      botId: "987",
      updateOffset: 0,
      lastUpdateAt: null,
      webhookSecretEncrypted: null,
      transportFingerprint: "configured",
      transportError: null,
      vapidPublicKey: null,
      vapidPrivateKeyEncrypted: null,
      version: 1,
      updatedAt: new Date(),
    },
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort)
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new DOMException("Aborted", "AbortError"))
    }
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
  })
}

function pendingPoll(_config: TelegramConfig, signal: AbortSignal) {
  return delay(30_000, signal)
}

function fixture() {
  const stopped = new AbortController()
  let current = config()
  const deps = {
    readConfig: vi.fn(async () => current),
    configure: vi.fn(async () => current),
    poll: vi.fn(pendingPoll),
    delay: vi.fn(delay),
    report: vi.fn(async (_error: unknown) => {}),
  }
  return {
    stopped,
    deps,
    change: (next: TelegramConfig) => {
      current = next
    },
  }
}

afterEach(() => vi.useRealTimers())

describe("continuous Telegram polling", () => {
  it("starts the next poll immediately after both an empty response and an update batch", async () => {
    const { stopped, deps } = fixture()
    deps.poll.mockImplementation(async () => {
      if (deps.poll.mock.calls.length === 3) stopped.abort()
    })
    await runPollingSession(stopped.signal, deps)
    expect(deps.poll).toHaveBeenCalledTimes(3)
    expect(deps.delay.mock.calls.every(([ms]) => ms === 1000)).toBe(true)
    expect(deps.report).toHaveBeenCalledWith(null)
  })

  it.each(["webhook", "token", "disabled"])(
    "aborts an in-flight poll within one second on %s changes",
    async (change) => {
      vi.useFakeTimers()
      const { stopped, deps, change: setConfig } = fixture()
      const running = runPollingSession(stopped.signal, deps)
      await vi.advanceTimersByTimeAsync(0)
      const oldSignal = deps.poll.mock.calls[0]![1]
      const next = config()
      next.row.version++
      if (change === "webhook") next.mode = "webhook"
      if (change === "token") next.token = "token-b"
      if (change === "disabled") next.token = null
      setConfig(next)
      await vi.advanceTimersByTimeAsync(1000)
      expect(oldSignal.aborted).toBe(true)
      if (change === "token") {
        expect(deps.poll.mock.calls[1]![0].token).toBe("token-b")
      } else {
        expect(deps.poll).toHaveBeenCalledTimes(1)
      }
      stopped.abort()
      await running
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it("backs off after conflicts, then resumes polling without a minute timer", async () => {
    vi.useFakeTimers()
    const { stopped, deps } = fixture()
    deps.poll.mockRejectedValueOnce(new DeliveryError("telegram_409"))
    const running = runPollingSession(stopped.signal, deps)
    await vi.advanceTimersByTimeAsync(4999)
    expect(deps.poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(deps.poll).toHaveBeenCalledTimes(2)
    expect(deps.report).toHaveBeenCalledWith(expect.objectContaining({ code: "telegram_409" }))
    stopped.abort()
    await running
  })

  it("cancels a retry delay immediately when the token changes", async () => {
    vi.useFakeTimers()
    const { stopped, deps, change } = fixture()
    deps.poll.mockRejectedValueOnce(new DeliveryError("telegram_429", true, 3600))
    const running = runPollingSession(stopped.signal, deps)
    await vi.advanceTimersByTimeAsync(0)
    const next = config()
    next.token = "replacement"
    next.row.version++
    change(next)
    await vi.advanceTimersByTimeAsync(1000)
    expect(deps.poll.mock.calls[1]![0].token).toBe("replacement")
    stopped.abort()
    await running
  })

  it("stops the request and configuration watcher on shutdown", async () => {
    vi.useFakeTimers()
    const { stopped, deps } = fixture()
    const running = runPollingSession(stopped.signal, deps)
    await vi.advanceTimersByTimeAsync(0)
    const signal = deps.poll.mock.calls[0]![1]
    stopped.abort()
    await running
    expect(signal.aborted).toBe(true)
    expect(deps.poll).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("uses bounded exponential backoff and respects Telegram retry_after", () => {
    expect(pollingBackoff(new Error(), 1)).toBe(1000)
    expect(pollingBackoff(new Error(), 20)).toBe(30_000)
    expect(pollingBackoff(new DeliveryError("telegram_409"), 1)).toBe(5000)
    expect(pollingBackoff(new DeliveryError("telegram_429", true, 60), 1)).toBe(60_000)
  })
})
