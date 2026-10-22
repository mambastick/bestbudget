"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { acceptInviteAction, inviteSignupAction, prepareSsoInviteAction } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAction } from "@/hooks/use-action"
import { toast } from "sonner"
import { CredentialsFields, emptyCredentials, validateCredentials } from "./credentials-fields"
import { SsoButton } from "./sso-button"

type Info = { householdName: string; role: string }

function Intro({ info }: { info: Info }) {
  return (
    <CardDescription>
      Вас пригласили в семейное пространство «<span className="font-medium text-foreground">{info.householdName}</span>» с ролью «{info.role}».
    </CardDescription>
  )
}

export function InviteAccept({ token, info, userName }: { token: string; info: Info; userName: string }) {
  const router = useRouter()
  const { pending, run } = useAction()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Приглашение</CardTitle>
        <Intro info={info} />
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        <p className="text-sm text-muted-foreground">Вы вошли как {userName}.</p>
        <Button
          disabled={pending}
          onClick={() =>
            run(() => acceptInviteAction(token), {
              success: `Вы присоединились к «${info.householdName}»`,
              onSuccess: () => {
                router.replace("/dashboard")
                router.refresh()
              },
            })
          }
        >
          Присоединиться
        </Button>
      </CardContent>
    </Card>
  )
}

export function InviteSignup({ token, info, local, sso }: { token: string; info: Info; local: boolean; sso: { name: string } | null }) {
  const router = useRouter()
  const [creds, setCreds] = useState(emptyCredentials)
  const [error, setError] = useState<string | null>(null)
  const { pending, run } = useAction()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const problem = validateCredentials(creds)
    setError(problem)
    if (problem) return
    run(() => inviteSignupAction({ token, name: creds.name, email: creds.email, password: creds.password }), {
      success: "Добро пожаловать!",
      onSuccess: () => {
        router.replace("/dashboard")
        router.refresh()
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Присоединиться к семье</CardTitle>
        <Intro info={info} />
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-4">
        {sso ? (
          <SsoButton
            name={sso.name}
            callbackURL={`/invite/${token}`}
            before={async () => {
              const res = await prepareSsoInviteAction(token)
              if (!res.ok) toast.error(res.error)
              return res.ok
            }}
          />
        ) : null}
        {local ? (
          <>
            {sso ? (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" /> или создайте аккаунт <div className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <form onSubmit={submit} className="grid grid-cols-1 gap-4">
              <CredentialsFields value={creds} onChange={setCreds} />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={pending}>
                {pending ? "Создание…" : "Создать аккаунт и присоединиться"}
              </Button>
            </form>
          </>
        ) : null}
        <p className="text-center text-sm text-muted-foreground">
          Уже есть аккаунт?{" "}
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="text-foreground underline underline-offset-4">
            Войдите
          </Link>
          , затем снова откройте ссылку.
        </p>
      </CardContent>
    </Card>
  )
}
