"use client"

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { HousePlus, Share, Smartphone } from "lucide-react"
import { installPlatform, isStandalone, subscribeStandalone } from "@/lib/pwa/platform"
import { PWA_COLORS } from "@/lib/pwa/splash"
import { registerServiceWorker, watchServiceWorkerUpdates } from "@/lib/pwa/service-worker"

interface InstallPrompt extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const PwaContext = createContext({ standalone: false, install: () => {} })
export const usePwa = () => useContext(PwaContext)
const subscribePlatform = () => () => {}

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("pwa")
  const locale = useLocale()
  const { resolvedTheme } = useTheme()
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, () => false)
  const platform = useSyncExternalStore(subscribePlatform, installPlatform, () => "browser" as const)
  const [installed, setInstalled] = useState(false)
  const [instructions, setInstructions] = useState(false)
  const prompt = useRef<InstallPrompt | null>(null)

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault()
      prompt.current = event as InstallPrompt
    }
    const onInstalled = () => { prompt.current = null; setInstalled(true) }
    window.addEventListener("beforeinstallprompt", beforeInstall)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("standalone", standalone)
  }, [standalone])

  useEffect(() => {
    // The offline document can read these device preferences without a session or a network.
    try { localStorage.setItem("bb_pwa_locale", locale) } catch { /* Storage may be disabled. */ }
  }, [locale])

  useEffect(() => {
    if (!resolvedTheme) return
    const color = resolvedTheme === "dark" ? PWA_COLORS.dark : PWA_COLORS.light
    // Keep both server-rendered media variants synchronized with the app's explicit theme.
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => { meta.content = color })
  }, [resolvedTheme])

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !window.isSecureContext || !("serviceWorker" in navigator)) return
    let stopped = false
    let cleanup = () => {}
    let requestedReload = false
    let lastCheck = Date.now()
    const toastId = "pwa-update"
    const showUpdate = (registration?: ServiceWorkerRegistration) => toast(t("update.available"), {
      id: toastId,
      duration: Infinity,
      description: t("update.description"),
      action: {
        label: t("update.action"),
        onClick: () => {
          if (registration?.waiting) {
            requestedReload = true
            registration.waiting.postMessage({ type: "SKIP_WAITING" })
          } else window.location.reload()
        },
      },
    })
    const controllerChanged = () => {
      if (requestedReload) window.location.reload()
      // Another tab may activate the update. Never reload this tab's unsaved form.
      else if (navigator.serviceWorker.controller) showUpdate()
    }
    const register = async () => {
      try {
        let hadController = !!navigator.serviceWorker.controller
        const registration = await registerServiceWorker()
        if (stopped) return
        // Do not advertise the first installation as an application update.
        const changed = () => {
          if (hadController || requestedReload) controllerChanged()
          hadController = true
        }
        navigator.serviceWorker.addEventListener("controllerchange", changed)
        const unwatch = watchServiceWorkerUpdates(registration, () => showUpdate(registration))
        const check = () => {
          if (document.visibilityState === "visible" && Date.now() - lastCheck > 60 * 60 * 1000) {
            lastCheck = Date.now()
            void registration.update().catch(() => {})
          }
        }
        document.addEventListener("visibilitychange", check)
        cleanup = () => {
          unwatch()
          navigator.serviceWorker.removeEventListener("controllerchange", changed)
          document.removeEventListener("visibilitychange", check)
        }
      } catch { /* Installation is optional when the browser blocks service workers. */ }
    }
    if (document.readyState === "complete") void register()
    else window.addEventListener("load", register, { once: true })
    return () => {
      stopped = true
      window.removeEventListener("load", register)
      cleanup()
      toast.dismiss(toastId)
    }
  }, [t])

  useEffect(() => {
    // Next's client navigation uses RSC requests. Offline, use a document navigation so the SW can help.
    const navigateOffline = (event: MouseEvent) => {
      if (navigator.onLine || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest("a") : null
      if (!link || link.target || link.hasAttribute("download")) return
      const url = new URL(link.href)
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return
      event.preventDefault()
      event.stopPropagation()
      location.assign(url.href)
    }
    document.addEventListener("click", navigateOffline, true)
    return () => document.removeEventListener("click", navigateOffline, true)
  }, [])

  async function install() {
    const deferred = prompt.current
    prompt.current = null
    if (!deferred) return setInstructions(true)
    try {
      await deferred.prompt()
      await deferred.userChoice
    } catch { toast.error(t("failed")); setInstructions(true) }
  }

  return (
    <PwaContext.Provider value={{ standalone: standalone || installed, install: () => void install() }}>
      {children}
      <Sheet open={instructions} onOpenChange={setInstructions}>
        <SheetContent side="bottom" className="mx-auto max-h-[90dvh] max-w-lg overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{t("instructions")}</SheetTitle>
            <SheetDescription>{t(platform)}</SheetDescription>
          </SheetHeader>
          {platform !== "browser" ? <ol className="grid grid-cols-1 gap-4 px-4">
            {[{ icon: Share, label: t("share") }, { icon: HousePlus, label: t("addHome") }, { icon: Smartphone, label: t("launch") }].map((step, index) => (
              <li key={step.label} className="flex items-center gap-4 rounded-xl border bg-muted/40 p-4">
                <step.icon aria-hidden className="size-8 shrink-0 text-primary" />
                <span className="text-sm"><span className="mr-2 text-muted-foreground">{index + 1}.</span>{step.label}</span>
              </li>
            ))}
          </ol> : null}
          <SheetFooter><Button onClick={() => setInstructions(false)}>{t("done")}</Button></SheetFooter>
        </SheetContent>
      </Sheet>
    </PwaContext.Provider>
  )
}
