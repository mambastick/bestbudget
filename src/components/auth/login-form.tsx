"use client"

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
      setError(authErrorMessage(error))
      setPending(false)
      return
    }
    router.replace(next)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Вход</CardTitle>
        <CardDescription>Семейный бюджет: доходы, расходы и прогноз</CardDescription>
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
                <FieldLabel htmlFor="password">Пароль</FieldLabel>
                {canResetPassword ? (
                  <Link href="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                    Забыли пароль?
                  </Link>
                ) : null}
              </div>
              <PasswordInput id="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Вход…" : "Войти"}
            </Button>
          </form>
        ) : null}
        {local && sso ? (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> или <div className="h-px flex-1 bg-border" />
          </div>
        ) : null}
        {sso ? <SsoButton name={sso.name} callbackURL={next} /> : null}
        {publicRegistration ? (
          <p className="text-center text-sm text-muted-foreground">
            Нет аккаунта?{" "}
            <Link href="/register" className="text-foreground underline underline-offset-4">
              Зарегистрироваться
            </Link>
          </p>
        ) : (
          <p className="text-center text-xs text-muted-foreground">
            Регистрация — по приглашению. {canResetPassword ? "" : "Если вы забыли пароль, обратитесь к администратору."}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
