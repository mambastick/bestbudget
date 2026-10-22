"use client"

import { useState } from "react"
import { updateAuthSettingsAction } from "@/app/actions/admin"
import { Section } from "@/components/app/settings/section"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useAction } from "@/hooks/use-action"
import type { AppSettings } from "@/server/services/settings"

export function AuthSettingsForm({ settings, oidcActive, localForced, smtp }: { settings: AppSettings; oidcActive: boolean; localForced: boolean; smtp: boolean }) {
  const [s, setS] = useState(settings)
  const { pending, run } = useAction()
  return (
    <Section title="Способы входа" description="Хотя бы один способ входа всегда остаётся включённым.">
      <form
        className="grid grid-cols-1 gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => updateAuthSettingsAction(s), { success: "Настройки сохранены" })
        }}
      >
        <Field>
          <FieldLabel htmlFor="app-name">Название приложения</FieldLabel>
          <Input id="app-name" value={s.appName} maxLength={40} onChange={(e) => setS({ ...s, appName: e.target.value })} />
        </Field>
        <Toggle
          label="Вход по e-mail и паролю"
          hint={
            localForced
              ? "Принудительно включён переменной AUTH_FORCE_LOCAL_LOGIN (аварийный доступ)."
              : oidcActive
                ? "Чтобы отключить, привяжите SSO к своему аккаунту — иначе можно потерять доступ."
                : "Нельзя отключить, пока SSO не настроен и не включён."
          }
          checked={s.localAuthEnabled}
          onChange={(v) => setS({ ...s, localAuthEnabled: v })}
        />
        <Toggle
          label="Публичная регистрация"
          hint="По умолчанию выключена: новые пользователи приходят только по приглашениям."
          checked={s.publicRegistration}
          onChange={(v) => setS({ ...s, publicRegistration: v })}
        />
        <p className="text-xs text-muted-foreground">
          Восстановление пароля по e-mail: {smtp ? "включено (SMTP настроен)" : "SMTP не настроен — сбрасывайте пароли во вкладке «Пользователи»"}.
        </p>
        <Button type="submit" className="justify-self-start" disabled={pending}>
          Сохранить
        </Button>
      </form>
    </Section>
  )
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border p-3">
      <span className="text-sm">
        <span className="font-medium">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  )
}
