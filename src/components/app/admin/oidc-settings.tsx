"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
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
  const t = useTranslations("admin")
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
      description={t("oidcHint")}
      action={fromEnv ? <Badge variant="secondary">{t("fromEnv")}</Badge> : null}
    >
      {fromEnv ? (
        <p className="mb-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          {t("oidcEnv")}</p>
      ) : null}
      <form
        className="grid grid-cols-1 gap-4"
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
            { success: t("oidcSaved"), onSuccess: () => setSecret("") },
          )
        }}
      >
        <fieldset disabled={fromEnv} className="grid grid-cols-1 gap-4">
          <Toggle label={t("enableSso")} checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} disabled={fromEnv} />
          <Field>
            <FieldLabel htmlFor="oidc-name">{t("displayName")}</FieldLabel>
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
                onClick={() => testing.run(() => testOidcDiscoveryAction(s.issuerUrl), { onSuccess: (d) => toast.success(t("providerAvailable", { issuer: d.issuer })) })}
              >
                {t("check")}
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
              placeholder={s.hasSecret ? t("keepSecret") : ""}
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
              {t.rich("registerRedirect", { uriTag: (chunks) => <code className="break-all">{chunks}</code>, uri: s.redirectUri || defaultRedirectUri })}
            </p>
          </Field>
          <Toggle
            label={t("ssoSignup")}
            hint={t("ssoSignupHint")}
            checked={s.allowSignup}
            onChange={(v) => setS({ ...s, allowSignup: v })}
            disabled={fromEnv}
          />
        </fieldset>
        {!fromEnv ? (
          <Button type="submit" className="justify-self-start" disabled={pending}>
            {t("save")}
          </Button>
        ) : null}
      </form>
    </Section>
  )
}
