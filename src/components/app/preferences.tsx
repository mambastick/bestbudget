"use client"

import { createContext, useContext, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import { Languages, Palette, Settings2 } from "lucide-react"
import { setLocaleAction } from "@/app/actions/preferences"
import { Segmented } from "@/components/app/segmented"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { useAction } from "@/hooks/use-action"
import { isLocale, type LocalePreference } from "@/i18n/locale"

const LocalePreferenceContext = createContext<LocalePreference>(null)
export function LocalePreferenceProvider({ value, children }: { value: LocalePreference; children: React.ReactNode }) {
  return <LocalePreferenceContext value={value}>{children}</LocalePreferenceContext>
}

const subscribe = () => () => {}

function usePreferences() {
  const t = useTranslations("common.preferences")
  const preference = useContext(LocalePreferenceContext)
  const router = useRouter()
  const { pending, run } = useAction()
  const { theme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  const languageOptions = [
    { value: "system", label: t("systemLanguage") },
    { value: "en", label: "English" },
    { value: "ru", label: "Русский" },
  ]
  const themeOptions = [
    { value: "system", label: t("systemTheme") },
    { value: "light", label: t("light") },
    { value: "dark", label: t("dark") },
  ]
  return {
    t, pending, languageOptions, themeOptions, language: preference ?? "system", theme: mounted ? theme ?? "system" : "system", setTheme,
    setLanguage: (value: string) => run(() => setLocaleAction(isLocale(value) ? value : null), { onSuccess: () => router.refresh() }),
  }
}

export function PreferenceMenuItems() {
  const p = usePreferences()
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger openOnHover={false}><Languages /> {p.t("language")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={p.language} onValueChange={p.setLanguage} disabled={p.pending}>
            {p.languageOptions.map((o) => <DropdownMenuRadioItem closeOnClick key={o.value} value={o.value}>{o.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger openOnHover={false}><Palette /> {p.t("theme")}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={p.theme} onValueChange={p.setTheme}>
            {p.themeOptions.map((o) => <DropdownMenuRadioItem closeOnClick key={o.value} value={o.value}>{o.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}

export function PreferencesForm() {
  const p = usePreferences()
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid gap-2">
        <span className="text-sm font-medium">{p.t("language")}</span>
        <Segmented aria-label={p.t("language")} value={p.language} onChange={p.setLanguage} options={p.languageOptions} disabled={p.pending} />
      </div>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{p.t("theme")}</span>
        <Segmented aria-label={p.t("theme")} value={p.theme} onChange={p.setTheme} options={p.themeOptions} />
      </div>
    </div>
  )
}

export function AuthPreferences() {
  const t = useTranslations("common.preferences")
  return (
    <div className="absolute top-3 right-3">
      <DropdownMenu animated={false}>
        <DropdownMenuTrigger render={<Button size="icon" variant="ghost" aria-label={t("appearance")} />}><Settings2 /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48"><PreferenceMenuItems /></DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
