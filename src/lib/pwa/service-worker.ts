/** Registration never asks for notification permission; push remains opt-in. */
export function registerServiceWorker() {
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
}

export function watchServiceWorkerUpdates(registration: ServiceWorkerRegistration, onWaiting: () => void) {
  let stopInstalling = () => {}
  const watch = () => {
    stopInstalling()
    const worker = registration.installing
    if (!worker) return
    const changed = () => {
      if (worker.state === "installed" && registration.waiting && navigator.serviceWorker.controller) onWaiting()
      if (worker.state === "installed" || worker.state === "redundant") worker.removeEventListener("statechange", changed)
    }
    worker.addEventListener("statechange", changed)
    stopInstalling = () => worker.removeEventListener("statechange", changed)
  }
  if (registration.waiting && navigator.serviceWorker.controller) onWaiting()
  watch()
  registration.addEventListener("updatefound", watch)
  return () => {
    stopInstalling()
    registration.removeEventListener("updatefound", watch)
  }
}
