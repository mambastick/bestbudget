"use client"

import { useState } from "react"
import { toast } from "sonner"
import { testOidcDiscoveryAction, updateOidcSettingsAction } from "@/app/actions/admin"
import { Section } from "@/components/app/settings/section"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/auth/password-input"
import { useAction } from "@/hooks/use-action"
import { Toggle } from "./auth-settings"

interface OidcValue {
  enabled: boolean
  displayName: string
  issuerUrl: string
  clientId: string
  hasSecret: boolean
  scopes: string
  redirectUri: string
  allowSignup: boolean
}

export function OidcSettingsForm({ source, value, defaultRedirectUri }: { source: "env" | "db"; value: OidcValue | null; defaultRedirectUri: string }) {
  const fromEnv = source === "env"
  const [s, setS] = useState<OidcValue>(
    value ?? { enabled: false, displayName: "SSO", issuerUrl: "", clientId: "", hasSecret: false, scopes: "openid profile email", redirectUri: "", allowSignup: false },
  )
  const [secret, setSecret] = useState("")
  const { pending, run } = useAction()
  const testing = useAction()

  return (
    <Section
      title="SSO (OpenID Connect)"
      description="Keycloak, Authentik, Microsoft Entra ID и другие OIDC-провайдеры. Секрет хранится в зашифрованном виде."
      action={fromEnv ? <Badge variant="secondary">из переменных окружения</Badge> : null}
    >
      {fromEnv ? (
        <p className="mb-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          Провайдер настроен через OIDC_* в переменных окружения — они имеют приоритет над настройками в интерфейсе. Чтобы управлять SSO здесь, уберите
          OIDC_ISSUER из окружения.
        </p>
      ) : null}
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          run(
            () =>
              updateOidcSettingsAction({
                enabled: s.enabled,
                displayName: s.displayName,
                issuerUrl: s.issuerUrl,
                clientId: s.clientId,
                clientSecret: secret || undefined,
                scopes: s.scopes,
                redirectUri: s.redirectUri,
                allowSignup: s.allowSignup,
              }),
            { success: "Настройки SSO сохранены", onSuccess: () => setSecret("") },
          )
        }}
      >
        <fieldset disabled={fromEnv} className="grid gap-4">
          <Toggle label="Включить вход через SSO" checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} disabled={fromEnv} />
          <Field>
            <FieldLabel htmlFor="oidc-name">Отображаемое название</FieldLabel>
            <Input id="oidc-name" value={s.displayName} maxLength={40} onChange={(e) => setS({ ...s, displayName: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="oidc-issuer">Issuer URL</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="oidc-issuer"
                value={s.issuerUrl}
                placeholder="https://auth.example.com/realms/family"
                onChange={(e) => setS({ ...s, issuerUrl: e.target.value })}
              />
              <Button
                type="button"
                variant="outline"
                disabled={testing.pending || !s.issuerUrl}
                onClick={() => testing.run(() => testOidcDiscoveryAction(s.issuerUrl), { onSuccess: (d) => toast.success(`Провайдер доступен: ${d.issuer}`) })}
              >
                Проверить
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="oidc-client">Client ID</FieldLabel>
            <Input id="oidc-client" value={s.clientId} onChange={(e) => setS({ ...s, clientId: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="oidc-secret">Client Secret</FieldLabel>
            <PasswordInput
              id="oidc-secret"
              autoComplete="off"
              value={secret}
              placeholder={s.hasSecret ? "•••••• (сохранён; оставьте пустым, чтобы не менять)" : ""}
              onChange={(e) => setSecret(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="oidc-scopes">Scopes</FieldLabel>
            <Input id="oidc-scopes" value={s.scopes} onChange={(e) => setS({ ...s, scopes: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="oidc-redirect">Redirect URI</FieldLabel>
            <Input id="oidc-redirect" value={s.redirectUri} placeholder={defaultRedirectUri} onChange={(e) => setS({ ...s, redirectUri: e.target.value })} />
            <p className="text-xs text-muted-foreground">
              Зарегистрируйте в провайдере: <code className="break-all">{s.redirectUri || defaultRedirectUri}</code>
            </p>
          </Field>
          <Toggle
            label="Создавать аккаунты при первом входе через SSO"
            hint="Если выключено, новый пользователь может войти через SSO только по приглашению. Существующие аккаунты по e-mail не связываются автоматически."
            checked={s.allowSignup}
            onChange={(v) => setS({ ...s, allowSignup: v })}
            disabled={fromEnv}
          />
        </fieldset>
        {!fromEnv ? (
          <Button type="submit" className="justify-self-start" disabled={pending}>
            Сохранить
          </Button>
        ) : null}
      </form>
    </Section>
  )
}
