"use client"

import { useTranslations } from "next-intl"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { setupAdminAction } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { useAction } from "@/hooks/use-action"
import { CredentialsFields, emptyCredentials, validateCredentials } from "./credentials-fields"
import { PasswordInput } from "./password-input"

export function SetupForm({ tokenConfigured }: { tokenConfigured: boolean }) {
  const t = useTranslations("auth")
  const router = useRouter()
  const [token, setToken] = useState("")
  const [creds, setCreds] = useState(emptyCredentials)
  const [error, setError] = useState<string | null>(null)
  const { pending, run } = useAction()

  if (!tokenConfigured) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("setup.initialSetup")}</CardTitle>
          <CardDescription>
            {t("setup.noAdministratorHasBeenCreatedSetTheEnvironment")}{" "}<code className="rounded bg-muted px-1">SETUP_TOKEN</code> {t("setup.aRandomStringRestartTheAppThenOpen")}{" "}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t("setup.orCreateAnAdministratorFromTheCommandLine")}{" "}<pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs">docker compose exec app node dist-scripts/admin.mjs create-admin</pre>
        </CardContent>
      </Card>
    )
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const problem = validateCredentials(creds, t)
    setError(problem)
    if (problem) return
    run(() => setupAdminAction({ token, name: creds.name, email: creds.email, password: creds.password }), {
      success: t("setup.administratorCreated"),
      onSuccess: () => {
        router.replace("/onboarding")
        router.refresh()
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("setup.initialSetup")}</CardTitle>
        <CardDescription>{t("setup.createTheApplicationSAdministratorAccountYouLl")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4">
          <Field>
            <FieldLabel htmlFor="token">{t("setup.setupToken")}</FieldLabel>
            <PasswordInput id="token" autoComplete="off" required value={token} onChange={(e) => setToken(e.target.value)} />
          </Field>
          <CredentialsFields value={creds} onChange={setCreds} />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? t("setup.creating") : t("setup.createAdministrator")}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
