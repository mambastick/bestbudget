"use client"

import { useLocale, useTranslations } from "next-intl"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { authClient, authErrorMessage } from "@/lib/auth-client"
import { CredentialsFields, emptyCredentials, validateCredentials } from "./credentials-fields"

export function RegisterForm() {
  const locale = useLocale()
  const t = useTranslations("auth")
  const router = useRouter()
  const [creds, setCreds] = useState(emptyCredentials)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const problem = validateCredentials(creds, t)
    setError(problem)
    if (problem) return
    setPending(true)
    const { error } = await authClient.signUp.email({ name: creds.name.trim(), email: creds.email.trim(), password: creds.password })
    if (error) {
      setError(authErrorMessage(error, locale))
      setPending(false)
      return
    }
    router.replace("/onboarding")
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("register.createAnAccount")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4">
          <CredentialsFields value={creds} onChange={setCreds} />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? t("register.creating") : t("register.createAccount")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t("register.alreadyHaveAnAccount")}{" "}
            <Link href="/login" className="text-foreground underline underline-offset-4">
              {t("register.signIn")}{" "}</Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
