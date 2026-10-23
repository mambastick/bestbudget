"use client"

import { useLocale, useTranslations } from "next-intl"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authClient, authErrorMessage } from "@/lib/auth-client"
import { PasswordInput } from "./password-input"
import { SsoButton } from "./sso-button"

export function LoginForm({
  local,
  sso,
  publicRegistration,
  canResetPassword,
  next = "/dashboard",
  error: initialError,
}: {
  local: boolean
  sso: { name: string } | null
  publicRegistration: boolean
  canResetPassword: boolean
  next?: string
  error?: string
}) {
  const locale = useLocale()
  const t = useTranslations("auth")
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState(initialError)
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(undefined)
    const { error } = await authClient.signIn.email({ email: email.trim(), password })
    if (error) {
      setError(authErrorMessage(error, locale))
      setPending(false)
      return
    }
    router.replace(next)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("login.title")}</CardTitle>
        <CardDescription>{t("login.familyFinancesIncomeExpensesAndForecasts")}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        {error ? <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p> : null}
        {local ? (
          <form onSubmit={submit} className="grid grid-cols-1 gap-4">
            <Field>
              <FieldLabel htmlFor="email">E-mail</FieldLabel>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="password">{t("login.password")}</FieldLabel>
                {canResetPassword ? (
                  <Link href="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                    {t("login.forgotPassword")}{" "}</Link>
                ) : null}
              </div>
              <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? t("login.signingIn") : t("login.signIn")}
            </Button>
          </form>
        ) : null}
        {local && sso ? (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> {t("login.or")}{" "}<div className="h-px flex-1 bg-border" />
          </div>
        ) : null}
        {sso ? <SsoButton name={sso.name} callbackURL={next} /> : null}
        {publicRegistration ? (
          <p className="text-center text-sm text-muted-foreground">
            {t("login.donTHaveAnAccount")}{" "}
            <Link href="/register" className="text-foreground underline underline-offset-4">
              {t("login.createAnAccount")}{" "}</Link>
          </p>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            {t("login.registrationIsByInvitation")}{" "}{canResetPassword ? "" : t("login.ifYouForgotYourPasswordContactYourAdministrator")}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
