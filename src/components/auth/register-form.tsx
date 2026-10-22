"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { authClient, authErrorMessage } from "@/lib/auth-client"
import { CredentialsFields, emptyCredentials, validateCredentials } from "./credentials-fields"

export function RegisterForm() {
  const router = useRouter()
  const [creds, setCreds] = useState(emptyCredentials)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const problem = validateCredentials(creds)
    setError(problem)
    if (problem) return
    setPending(true)
    const { error } = await authClient.signUp.email({ name: creds.name.trim(), email: creds.email.trim(), password: creds.password })
    if (error) {
      setError(authErrorMessage(error))
      setPending(false)
      return
    }
    router.replace("/onboarding")
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Регистрация</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          <CredentialsFields value={creds} onChange={setCreds} />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Создание…" : "Создать аккаунт"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Уже есть аккаунт?{" "}
            <Link href="/login" className="text-foreground underline underline-offset-4">
              Войти
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  )
}
