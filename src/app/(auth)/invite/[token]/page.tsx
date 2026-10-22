import type { Metadata } from "next"
import { LinkButton } from "@/components/app/link-button"
import { InviteAccept, InviteSignup } from "@/components/auth/invite"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ROLE_LABELS } from "@/domain/permissions"
import { getSession } from "@/server/session"
import { findValidInvitation } from "@/server/services/households"
import { getAuthMethods } from "@/server/services/settings"

export const metadata: Metadata = { title: "Приглашение" }
export const dynamic = "force-dynamic"

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const [invitation, session, methods] = await Promise.all([findValidInvitation(token), getSession(), getAuthMethods()])

  if (!invitation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Приглашение недействительно</CardTitle>
          <CardDescription>Ссылка устарела, уже была использована или отозвана. Попросите прислать новое приглашение.</CardDescription>
        </CardHeader>
        <div className="px-4">
          <LinkButton variant="outline" className="w-full" href="/login">
            Ко входу
          </LinkButton>
        </div>
      </Card>
    )
  }

  const info = { householdName: invitation.householdName, role: ROLE_LABELS[invitation.role] }
  if (session) return <InviteAccept token={token} info={info} userName={session.user.name} />
  return <InviteSignup token={token} info={info} local={methods.local} sso={methods.oidc ? { name: methods.oidc.displayName } : null} />
}
