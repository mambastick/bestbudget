import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { LinkButton } from "@/components/app/link-button"
import { InviteAccept, InviteSignup } from "@/components/auth/invite"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getSession } from "@/server/session"
import { findValidInvitation } from "@/server/services/households"
import { getAuthMethods } from "@/server/services/settings"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth")
  return { title: t("invite.invitation") }
}
export const dynamic = "force-dynamic"

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const t = await getTranslations("auth")
  const roles = await getTranslations("common.roles")
  const { token } = await params
  const [invitation, session, methods] = await Promise.all([findValidInvitation(token), getSession(), getAuthMethods()])

  if (!invitation) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("invite.invalidInvitation")}</CardTitle>
          <CardDescription>{t("invite.thisLinkHasExpiredHasAlreadyBeenUsed")}</CardDescription>
        </CardHeader>
        <div className="px-4">
          <LinkButton variant="outline" className="w-full" href="/login">
            {t("invite.backToSignIn")}{" "}</LinkButton>
        </div>
      </Card>
    )
  }

  const info = { householdName: invitation.householdName, role: roles(invitation.role) }
  if (session) return <InviteAccept token={token} info={info} userName={session.user.name} />
  return <InviteSignup token={token} info={info} local={methods.local} sso={methods.oidc ? { name: methods.oidc.displayName } : null} />
}
