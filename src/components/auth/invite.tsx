"use client"

import { useTranslations } from "next-intl"

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
  const t = useTranslations("auth")
  return (
    <CardDescription>
      {t.rich("invite.intro", { householdName: info.householdName, role: info.role, household: (chunks) => <span className="font-medium text-foreground">{chunks}</span> })}
    </CardDescription>
  )
}

export function InviteAccept({ token, info, userName }: { token: string; info: Info; userName: string }) {
  const t = useTranslations("auth")
  const router = useRouter()
  const { pending, run } = useAction()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("invite.invitation")}</CardTitle>
        <Intro info={info} />
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        <p className="text-sm text-muted-foreground">{t("invite.signedInAs", { userName })}</p>
        <Button
          disabled={pending}
          onClick={() =>
            run(() => acceptInviteAction(token), {
              success: t("invite.youJoined", { householdName: info.householdName }),
              onSuccess: () => {
                router.replace("/dashboard")
                router.refresh()
              },
            })
          }
        >
          {t("invite.joinHousehold")}{" "}</Button>
      </CardContent>
    </Card>
  )
}

export function InviteSignup({ token, info, local, sso }: { token: string; info: Info; local: boolean; sso: { name: string } | null }) {
  const t = useTranslations("auth")
  const router = useRouter()
  const [creds, setCreds] = useState(emptyCredentials)
  const [error, setError] = useState<string | null>(null)
  const { pending, run } = useAction()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const problem = validateCredentials(creds, t)
    setError(problem)
    if (problem) return
    run(() => inviteSignupAction({ token, name: creds.name, email: creds.email, password: creds.password }), {
      success: t("invite.welcome"),
      onSuccess: () => {
        router.replace("/dashboard")
        router.refresh()
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("invite.joinAHousehold")}</CardTitle>
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
                <div className="h-px flex-1 bg-border" /> {t("invite.orCreateAnAccount")}{" "}<div className="h-px flex-1 bg-border" />
              </div>
            ) : null}
            <form onSubmit={submit} className="grid grid-cols-1 gap-4">
              <CredentialsFields value={creds} onChange={setCreds} />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={pending}>
                {pending ? t("invite.creating") : t("invite.createAccountAndJoin")}
              </Button>
            </form>
          </>
        ) : null}
        <p className="text-center text-sm text-muted-foreground">
          {t("invite.alreadyHaveAnAccount")}{" "}
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="text-foreground underline underline-offset-4">
            {t("invite.signIn")}{" "}</Link>
          {t("invite.thenOpenThisLinkAgain")}{" "}</p>
      </CardContent>
    </Card>
  )
}
