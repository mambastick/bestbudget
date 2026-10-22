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
