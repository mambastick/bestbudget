import { readFileSync } from "node:fs"
import vm from "node:vm"
import { describe, expect, it } from "vitest"

function worker() {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>()
  const cached: string[] = []
  const deleted: string[] = []
  let skipped = false
  const self = {
    BESTBUDGET_BUILD: "test-build", location: { origin: "https://budget.test" }, navigator: { language: "ru-RU" },
    addEventListener: (type: string, fn: (event: Record<string, unknown>) => void) => listeners.set(type, fn),
    skipWaiting: async () => { skipped = true }, clients: { claim: async () => {}, openWindow: async () => {} },
  }
  const caches = {
    keys: async () => ["other-app-cache", "bestbudget-offline-old", "bestbudget-offline-test-build"],
    delete: async (name: string) => { deleted.push(name); return true },
    open: async () => ({ addAll: async (paths: string[]) => { cached.push(...paths) }, match: async () => new Response("offline") }),
  }
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches, importScripts: () => {}, URL, Response, fetch: async () => { throw new Error("offline") } })
  return { listeners, cached, deleted, skipped: () => skipped }
}

async function lifetime(fn: (event: Record<string, unknown>) => void, fields: Record<string, unknown> = {}) {
  let pending: Promise<unknown> | undefined
  fn({ ...fields, waitUntil: (promise: Promise<unknown>) => { pending = promise } })
  await pending
}

describe("service worker privacy and lifecycle", () => {
  it("precaches only public offline assets and waits for explicit activation", async () => {
    const w = worker()
    await lifetime(w.listeners.get("install")!)
    expect(w.cached).toEqual(["/offline/ru", "/offline/en", "/pwa-icon/192", "/pwa-icon/512", "/pwa-icon/512?maskable=1"])
    expect(w.skipped()).toBe(false)
    await lifetime(w.listeners.get("message")!, { data: { type: "SKIP_WAITING" } })
    expect(w.skipped()).toBe(true)
    await lifetime(w.listeners.get("activate")!)
    expect(w.deleted).toEqual(["bestbudget-offline-old"])
  })

  it.each([
    ["GET", "cors", "https://budget.test/api/health"],
    ["GET", "cors", "https://budget.test/dashboard?_rsc=1"],
    ["POST", "navigate", "https://budget.test/dashboard"],
    ["GET", "navigate", "https://idp.test/authorize"],
  ])("does not intercept %s %s %s", (method, mode, url) => {
    const w = worker()
    let intercepted = false
    w.listeners.get("fetch")!({ request: { method, mode, url }, respondWith: () => { intercepted = true } })
    expect(intercepted).toBe(false)
  })
})
