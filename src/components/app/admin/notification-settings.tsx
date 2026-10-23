"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { testTelegramAction, updateTelegramSettingsAction } from "@/app/actions/notifications"
import { Toggle } from "@/components/app/admin/auth-settings"
import { Section } from "@/components/app/settings/section"
import { Segmented } from "@/components/app/segmented"
import { PasswordInput } from "@/components/auth/password-input"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { useAction } from "@/hooks/use-action"
import type { notificationAdmin } from "@/server/notifications/view"

export function NotificationAdmin(props: Awaited<ReturnType<typeof notificationAdmin>>) {
  const t = useTranslations("admin")
  const locale = useLocale()
  const [token, setToken] = useState("")
  const [mode, setMode] = useState(props.mode)
  const [disabled, setDisabled] = useState(!props.enabled)
  const [version, setVersion] = useState(props.version)
  const action = useAction()
  return (
    <div className="grid grid-cols-1 gap-4">
      <Section
        title="Telegram"
        description={t("telegramHint")}
      >
        <p className="mb-3 text-sm">
          {t("botStatus", { bot: props.username ? `@${props.username}` : t("notConfigured"), jobs: t(props.jobsEnabled ? "jobsEnabled" : "jobsDisabled") })}
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          {t("lastUpdate", { date: props.lastUpdate ? new Date(props.lastUpdate).toLocaleString(locale) : t("none") })}
          {props.transportError ? ` · ${t("transportError", { error: props.transportError })}` : ""}
        </p>
        {props.fromEnv ? (
          <p className="mb-3 text-sm">
            {t("botEnv", { mode: props.mode })}
          </p>
        ) : (
          <form
            className="grid grid-cols-1 gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              action.run(() => updateTelegramSettingsAction({ token, mode, disabled, version }), {
                success: t("botSaved"),
                onSuccess: () => {
                  setToken("")
                  setVersion(version + 1)
                },
              })
            }}
          >
            <Toggle label={t("disableBot")} checked={disabled} onChange={setDisabled} />
            <Field>
              <FieldLabel htmlFor="telegram-token">{t("botToken")}</FieldLabel>
              <PasswordInput
                id="telegram-token"
                autoComplete="off"
                value={token}
                placeholder={props.enabled ? t("keepToken") : "123456:…"}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "polling", label: t("polling") },
                { value: "webhook", label: "Webhook (HTTPS)" },
              ]}
              disabled={props.modeFromEnv}
            />
            <Button type="submit" className="justify-self-start" disabled={action.pending}>
              {t("saveBot")}
            </Button>
          </form>
        )}
        <Button
          className="mt-4"
          variant="outline"
          disabled={action.pending || !props.enabled}
          onClick={() => action.run(testTelegramAction, { success: t("testSent") })}
        >
          {t("testTelegram")}
        </Button>
      </Section>
      <Section
        title="Web Push"
        description={t("pushHint")}
      >
        <p className="break-all font-mono text-xs">{props.publicKey}</p>
      </Section>
      <Section
        title={t("deliveryErrors")}
        description={t("deliveryHint")}
      >
        <ul className="divide-y">
          {props.errors.map((e) => (
            <li key={e.id} className="break-words py-2 text-xs">
              {new Date(e.createdAt).toLocaleString(locale)} · {e.channel} · {t.has(`deliveryKind.${e.kind}`) ? t(`deliveryKind.${e.kind}`) : e.kind} · {t.has(`deliveryStatus.${e.status}`) ? t(`deliveryStatus.${e.status}`) : e.status} · {e.error} ·
              {t("attempts", { count: e.attempts })}
            </li>
          ))}
          {!props.errors.length ? <li className="text-sm text-muted-foreground">{t("noErrors")}</li> : null}
        </ul>
      </Section>
    </div>
  )
}
