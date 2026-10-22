"use client"

import { useState } from "react"
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
  const [token, setToken] = useState("")
  const [mode, setMode] = useState(props.mode)
  const [disabled, setDisabled] = useState(!props.enabled)
  const [version, setVersion] = useState(props.version)
  const action = useAction()
  return (
    <div className="grid grid-cols-1 gap-4">
      <Section
        title="Telegram"
        description="Создайте бота через @BotFather. Токен хранится зашифрованным. Тест приходит в Telegram текущего администратора, подключённый в профиле."
      >
        <p className="mb-3 text-sm">
          Бот: {props.username ? `@${props.username}` : "не настроен"} · Фоновые задачи:{" "}
          {props.jobsEnabled ? "включены" : "отключены (JOBS_ENABLED=false)"}
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          Последний апдейт: {props.lastUpdate ? new Date(props.lastUpdate).toLocaleString("ru-RU") : "нет"}
          {props.transportError ? ` · Ошибка: ${props.transportError}` : ""}
        </p>
        {props.fromEnv ? (
          <p className="mb-3 text-sm">
            Токен задан через TELEGRAM_BOT_TOKEN. Режим: {props.mode}. Настройка через окружение имеет приоритет.
          </p>
        ) : (
          <form
            className="grid grid-cols-1 gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              action.run(() => updateTelegramSettingsAction({ token, mode, disabled, version }), {
                success: "Настройки бота сохранены",
                onSuccess: () => {
                  setToken("")
                  setVersion(version + 1)
                },
              })
            }}
          >
            <Toggle label="Отключить бота" checked={disabled} onChange={setDisabled} />
            <Field>
              <FieldLabel htmlFor="telegram-token">Токен бота</FieldLabel>
              <PasswordInput
                id="telegram-token"
                autoComplete="off"
                value={token}
                placeholder={props.enabled ? "Оставьте пустым, чтобы сохранить" : "123456:…"}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "polling", label: "Polling (за NAT)" },
                { value: "webhook", label: "Webhook (HTTPS)" },
              ]}
              disabled={props.modeFromEnv}
            />
            <Button type="submit" className="justify-self-start" disabled={action.pending}>
              Сохранить бота
            </Button>
          </form>
        )}
        <Button
          className="mt-4"
          variant="outline"
          disabled={action.pending || !props.enabled}
          onClick={() => action.run(testTelegramAction, { success: "Тест отправлен в ваш Telegram" })}
        >
          Тест Telegram
        </Button>
      </Section>
      <Section
        title="Web Push"
        description="Приватный VAPID-ключ хранится зашифрованным. При смене ключей браузеры нужно подключить заново."
      >
        <p className="break-all font-mono text-xs">{props.publicKey}</p>
      </Section>
      <Section
        title="Последние ошибки доставки"
        description="Без имён, адресов, названий семей и содержимого уведомлений. unknown — результат отправки неизвестен, повтор отключён."
      >
        <ul className="divide-y">
          {props.errors.map((e) => (
            <li key={e.id} className="break-words py-2 text-xs">
              {new Date(e.createdAt).toLocaleString("ru-RU")} · {e.channel} · {e.kind} · {e.status} · {e.error} ·
              попыток: {e.attempts}
            </li>
          ))}
          {!props.errors.length ? <li className="text-sm text-muted-foreground">Ошибок пока нет</li> : null}
        </ul>
      </Section>
    </div>
  )
}
