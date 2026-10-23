"use client"

import { useEffect } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useOperations } from "@/components/app/operations/operations-provider"

export function BackButton() {
  const t = useTranslations("pwa")
  const pathname = usePathname()
  const params = useSearchParams()
  const router = useRouter()
  const parts = pathname.split("/").filter(Boolean)
  const parent = parts.length > 1 ? `/${parts.slice(0, -1).join("/")}`
    : params.has("tab") && (pathname === "/settings" || pathname === "/admin") ? pathname : null
  if (!parent) return null
  // A deterministic parent also works when a nested page is opened directly from the home screen.
  return <Button variant="ghost" size="icon" onClick={() => router.push(parent)} aria-label={t("back")}><ArrowLeft /></Button>
}

export function TransactionShortcut() {
  const params = useSearchParams()
  const pathname = usePathname()
  const { openCreate } = useOperations()
  useEffect(() => {
    if (pathname !== "/dashboard" || params.get("new") !== "transaction") return
    const url = new URL(window.location.href)
    url.searchParams.delete("new")
    // Consume before opening, including React Strict Mode and returning from the dialog.
    if (!new URL(window.location.href).searchParams.has("new")) return
    window.history.replaceState(window.history.state, "", url)
    openCreate()
  }, [params, pathname, openCreate])
  return null
}
