"use client"

import { useLocale, useTranslations } from "next-intl"

import { KeyRound, Laptop, LogOut, Smartphone } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { PasswordInput } from "@/components/auth/password-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authClient, authErrorMessage } from "@/lib/auth-client"
import { formatDateTime } from "@/lib/dates"
import { InstallButton } from "@/components/app/pwa/install-button"
import { PreferencesForm } from "@/components/app/preferences"
import { Section } from "./section"

interface SessionInfo {
  id: string
  token: string
  userAgent?: string | null
  ipAddress?: string | null
  updatedAt: Date | string
}

function deviceName(ua: string | null | undefined, t: (key: string) => string) {
  if (!ua) return t("profile.unknownDevice")
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : t("profile.browser")
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : ""
  return [browser, os].filter(Boolean).join(", ")
}

export function ProfileSettings({
  user,
  hasPassword,
  localEnabled,
  timeZone,
  sso,
}: {
  user: { name: string; email: string }
  hasPassword: boolean
  localEnabled: boolean
  timeZone: string
  sso: { name: string; linked: boolean } | null
}) {
  const locale = useLocale()
  const t = useTranslations("settings")
  const router = useRouter()
  const [name, setName] = useState(user.name)
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [currentToken, setCurrentToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [reload, setReload] = useState(0)
  const loadSessions = useCallback(() => setReload((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    Promise.all([authClient.listSessions(), authClient.getSession()]).then(([list, session]) => {
      if (cancelled) return
      setSessions((list.data ?? []) as SessionInfo[])
      setCurrentToken(session.data?.session.token ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [reload])

  async function saveName(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await authClient.updateUser({ name: name.trim() })
    if (error) return void toast.error(authErrorMessage(error, locale))
    toast.success(t("profile.nameSaved"))
    router.refresh()
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (next.length < 10) return void toast.error(t("profile.newPasswordMustBeAtLeastCharacters"))
    setBusy(true)
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true })
    setBusy(false)
    if (error) return void toast.error(authErrorMessage(error, locale))
    setCurrent("")
    setNext("")
    toast.success(t("profile.passwordChangedOtherSessionsHaveBeenSignedOut"))
    loadSessions()
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section title={t("profile.profile")}>
        <InstallButton />
        <div className="h-4" />
        <PreferencesForm />
        <div className="h-4" />
        <form onSubmit={saveName} className="grid grid-cols-1 gap-4">
          <Field>
            <FieldLabel htmlFor="p-name">{t("profile.name")}</FieldLabel>
            <Input id="p-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-email">E-mail</FieldLabel>
            <Input id="p-email" value={user.email} disabled />
          </Field>
          <Button type="submit" className="justify-self-start" disabled={!name.trim() || name === user.name}>
            {t("profile.save")}{" "}</Button>
        </form>
      </Section>

      <Section title={t("profile.password")} description={hasPassword ? t("profile.changingYourPasswordSignsOutOtherSessions") : t("profile.youSignInWithSsoOnly")}>
        {hasPassword && localEnabled ? (
          <form onSubmit={changePassword} className="grid grid-cols-1 gap-4">
            <Field>
              <FieldLabel htmlFor="p-current">{t("profile.currentPassword")}</FieldLabel>
              <PasswordInput id="p-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="p-next">{t("profile.newPassword")}</FieldLabel>
              <PasswordInput id="p-next" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Button type="submit" className="justify-self-start" disabled={busy || !current || !next}>
              {t("profile.changePassword")}{" "}</Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">{hasPassword ? t("profile.passwordSignInIsDisabledByTheAdministrator") : t("profile.noPasswordSet")}</p>
        )}
      </Section>

      {sso ? (
        <Section title={t("profile.singleSignOnSso")} description={t("profile.linkAnAccountToSignInWithYour")}>
          {sso.linked ? (
            <div className="flex items-center gap-2 text-sm">
              <KeyRound className="size-4 text-muted-foreground" /> {sso.name}
              <Badge variant="secondary">{t("profile.linked")}</Badge>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={async () => {
                const { error } = await authClient.linkSocial({ provider: "oidc", callbackURL: "/settings?tab=profile" })
                if (error) toast.error(authErrorMessage(error, locale))
              }}
            >
              <KeyRound /> {t("profile.link")}{" "}{sso.name}
            </Button>
          )}
        </Section>
      ) : null}

      <Section
        title={t("profile.activeSessions")}
        description={t("profile.devicesSignedInToYourAccount")}
        action={
          sessions && sessions.length > 1 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await authClient.revokeOtherSessions()
                toast.success(t("profile.otherSessionsSignedOut"))
                loadSessions()
              }}
            >
              {t("profile.signOutOtherSessions")}{" "}</Button>
          ) : null
        }
      >
        {sessions === null ? (
          <p className="text-sm text-muted-foreground">{t("profile.loading")}</p>
        ) : (
          <ul className="divide-y">
            {sessions.map((s) => {
              const isCurrent = s.token === currentToken
              const mobile = /Android|iPhone|iPad/.test(s.userAgent ?? "")
              return (
                <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
                  {mobile ? <Smartphone className="size-4 text-muted-foreground" /> : <Laptop className="size-4 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      {deviceName(s.userAgent, t)} {isCurrent ? <Badge className="ml-1">{t("profile.thisDevice")}</Badge> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.ipAddress ? `${s.ipAddress} · ` : ""}
                      {formatDateTime(s.updatedAt, timeZone, locale)}
                    </div>
                  </div>
                  {!isCurrent ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("profile.signOutSession")}
                      onClick={async () => {
                        await authClient.revokeSession({ token: s.token })
                        loadSessions()
                      }}
                    >
                      <LogOut />
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </div>
  )
}
