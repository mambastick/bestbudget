"use client"

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
import { Section } from "./section"

interface SessionInfo {
  id: string
  token: string
  userAgent?: string | null
  ipAddress?: string | null
  updatedAt: Date | string
}

function deviceName(ua?: string | null) {
  if (!ua) return "Неизвестное устройство"
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Браузер"
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : ""
  return [browser, os].filter(Boolean).join(", ")
}

export function ProfileSettings({
  user,
  hasPassword,
  localEnabled,
  sso,
}: {
  user: { name: string; email: string }
  hasPassword: boolean
  localEnabled: boolean
  sso: { name: string; linked: boolean } | null
}) {
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
    if (error) return void toast.error(authErrorMessage(error))
    toast.success("Имя сохранено")
    router.refresh()
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (next.length < 10) return void toast.error("Новый пароль должен быть не короче 10 символов")
    setBusy(true)
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true })
    setBusy(false)
    if (error) return void toast.error(authErrorMessage(error))
    setCurrent("")
    setNext("")
    toast.success("Пароль изменён, остальные сеансы завершены")
    loadSessions()
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section title="Профиль">
        <form onSubmit={saveName} className="grid grid-cols-1 gap-4">
          <Field>
            <FieldLabel htmlFor="p-name">Имя</FieldLabel>
            <Input id="p-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="p-email">E-mail</FieldLabel>
            <Input id="p-email" value={user.email} disabled />
          </Field>
          <Button type="submit" className="justify-self-start" disabled={!name.trim() || name === user.name}>
            Сохранить
          </Button>
        </form>
      </Section>

      <Section title="Пароль" description={hasPassword ? "После смены пароля остальные сеансы будут завершены." : "Вы входите только через SSO."}>
        {hasPassword && localEnabled ? (
          <form onSubmit={changePassword} className="grid grid-cols-1 gap-4">
            <Field>
              <FieldLabel htmlFor="p-current">Текущий пароль</FieldLabel>
              <PasswordInput id="p-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="p-next">Новый пароль</FieldLabel>
              <PasswordInput id="p-next" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Button type="submit" className="justify-self-start" disabled={busy || !current || !next}>
              Сменить пароль
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">{hasPassword ? "Вход по паролю отключён администратором." : "Пароль не задан."}</p>
        )}
      </Section>

      {sso ? (
        <Section title="Единый вход (SSO)" description="Привязка позволяет входить через корпоративного или семейного провайдера идентификации.">
          {sso.linked ? (
            <div className="flex items-center gap-2 text-sm">
              <KeyRound className="size-4 text-muted-foreground" /> {sso.name}
              <Badge variant="secondary">привязан</Badge>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={async () => {
                const { error } = await authClient.linkSocial({ provider: "oidc", callbackURL: "/settings?tab=profile" })
                if (error) toast.error(authErrorMessage(error))
              }}
            >
              <KeyRound /> Привязать {sso.name}
            </Button>
          )}
        </Section>
      ) : null}

      <Section
        title="Активные сеансы"
        description="Устройства, на которых выполнен вход."
        action={
          sessions && sessions.length > 1 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await authClient.revokeOtherSessions()
                toast.success("Остальные сеансы завершены")
                loadSessions()
              }}
            >
              Завершить остальные
            </Button>
          ) : null
        }
      >
        {sessions === null ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
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
                      {deviceName(s.userAgent)} {isCurrent ? <Badge className="ml-1">это устройство</Badge> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.ipAddress ? `${s.ipAddress} · ` : ""}
                      {formatDateTime(s.updatedAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}
                    </div>
                  </div>
                  {!isCurrent ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Завершить сеанс"
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
