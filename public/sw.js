// A build-specific imported script makes updates detectable even when this file is unchanged.
importScripts("/sw-version.js")
const CACHE_PREFIX = "bestbudget-offline-"
const CACHE_NAME = CACHE_PREFIX + self.BESTBUDGET_BUILD
const OFFLINE_ASSETS = ["/offline/ru", "/offline/en", "/pwa-icon/192", "/pwa-icon/512", "/pwa-icon/512?maskable=1"]

self.addEventListener("install", (event) => {
  // Only public offline documents and icons. No app shell, financial pages, RSC or API responses.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_ASSETS)))
})
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name)
    }
    await self.clients.claim()
  })())
})
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting())
})
self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin) return
  if (OFFLINE_ASSETS.includes(url.pathname + url.search)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => (await cache.match(request)) || fetch(request)))
    return
  }
  if (request.mode !== "navigate") return
  event.respondWith((async () => {
    try {
      return await fetch(request, { cache: "no-store" })
    } catch {
      const locale = self.navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en"
      // The document applies the last app language/theme from localStorage, including after SW restart.
      const cache = await caches.open(CACHE_NAME)
      return (await cache.match("/offline/" + locale)) || Response.error()
    }
  })())
})

self.addEventListener("push", (event) => {
  let data
  try { data = event.data?.json() } catch { return }
  if (!data) return
  event.waitUntil(self.registration.showNotification(data.title || "BestBudget", {
    body: data.body || "", icon: "/pwa-icon/192", tag: data.tag,
    data: { url: typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/dashboard" },
  }))
})
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || "/dashboard", self.location.origin)
  if (url.origin !== self.location.origin) return
  event.waitUntil(self.clients.openWindow(url.href))
})
