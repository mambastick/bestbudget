"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { updateAuthSettingsAction } from "@/app/actions/admin"
import { Section } from "@/components/app/settings/section"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useAction } from "@/hooks/use-action"
import type { AppSettings } from "@/server/services/settings"

export function AuthSettingsForm({ settings, oidcActive, localForced, smtp }: { settings: AppSettings; oidcActive: boolean; localForced: boolean; smtp: boolean }) {
  const t = useTranslations("admin")
  const [s, setS] = useState(settings)
  const { pending, run } = useAction()
  return (
    <Section title={t("signInMethods")} description={t("signInHint")}>
      <form
        className="grid grid-cols-1 gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => updateAuthSettingsAction(s), { success: t("saved") })
        }}
      >
        <Field>
          <FieldLabel htmlFor="app-name">{t("appName")}</FieldLabel>
          <Input id="app-name" value={s.appName} maxLength={40} onChange={(e) => setS({ ...s, appName: e.target.value })} />
        </Field>
        <Toggle
          label={t("passwordSignIn")}
          hint={
            localForced
              ? t("localForced")
              : oidcActive
                ? t("linkSsoFirst")
                : t("configureSsoFirst")
          }
          checked={s.localAuthEnabled}
          onChange={(v) => setS({ ...s, localAuthEnabled: v })}
        />
        <Toggle
          label={t("publicRegistration")}
          hint={t("registrationHint")}
          checked={s.publicRegistration}
          onChange={(v) => setS({ ...s, publicRegistration: v })}
        />
        <p className="text-xs text-muted-foreground">
          {t(smtp ? "resetEnabled" : "resetDisabled")}
        </p>
        <Button type="submit" className="justify-self-start" disabled={pending}>
          {t("save")}
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
