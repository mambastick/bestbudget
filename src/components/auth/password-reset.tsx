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

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    const { error } = await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/reset-password" })
    setPending(false)
    // The response is the same whether or not the e-mail exists.
    if (error && error.status === 429) return setError(authErrorMessage(error))
    setSent(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Восстановление доступа</CardTitle>
        <CardDescription>Мы отправим ссылку для смены пароля, если такой аккаунт существует.</CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <p className="text-sm">Проверьте почту. Ссылка действует 1 час.</p>
        ) : (
          <form onSubmit={submit} className="grid grid-cols-1 gap-4">
            <Field>
              <FieldLabel htmlFor="email">E-mail</FieldLabel>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              Отправить ссылку
            </Button>
          </form>
        )}
        <Link href="/login" className="mt-4 block text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          Вернуться ко входу
        </Link>
      </CardContent>
    </Card>
  )
}

export function ResetPasswordForm({ token, invalid }: { token: string | null; invalid: boolean }) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(invalid || !token ? "Ссылка недействительна или устарела" : null)
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    if (password.length < 10) return setError("Пароль должен быть не короче 10 символов")
    setPending(true)
    const { error } = await authClient.resetPassword({ newPassword: password, token })
    setPending(false)
    if (error) return setError(authErrorMessage(error))
    router.replace("/login")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Новый пароль</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4">
          <Field>
            <FieldLabel htmlFor="password">Пароль</FieldLabel>
            <PasswordInput id="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!token} />
          </Field>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending || !token}>
            Сохранить
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
