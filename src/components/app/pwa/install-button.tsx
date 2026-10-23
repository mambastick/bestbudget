"use client"

import { useTranslations } from "next-intl"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { usePwa } from "./pwa-provider"

export function InstallButton({ menu = false }: { menu?: boolean }) {
  const t = useTranslations("pwa")
  const { standalone, install } = usePwa()
  if (standalone) return null
  if (menu) return <DropdownMenuItem onClick={install}><Download />{t("install")}</DropdownMenuItem>
  return <div className="grid grid-cols-1 gap-2">
    <Button variant="outline" className="justify-self-start" onClick={install}><Download />{t("install")}</Button>
    <p className="text-sm text-muted-foreground">{t("description")}</p>
  </div>
}
