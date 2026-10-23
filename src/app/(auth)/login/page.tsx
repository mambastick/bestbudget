import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { LoginForm } from "@/components/auth/login-form"
import { smtpEnabled } from "@/lib/mail"
import { getSession } from "@/server/session"
import { getAuthMethods } from "@/server/services/settings"
import { adminExists } from "@/server/services/users"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth")
  return { title: t("login.title") }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const t = await getTranslations("auth")
  const OAUTH_ERRORS: Record<string, string> = {
    signup_disabled: t("login.registrationIsClosedAskYourAdministratorOrA"),
    unable_to_create_user: t("login.registrationIsClosedAskYourAdministratorOrA"),
    account_not_linked: t("login.anAccountWithThisEmailAlreadyExistsSign"),
    email_not_verified: t("login.theProviderHasnTVerifiedYourEmail"),
    banned: t("login.yourAccountHasBeenBlockedByTheAdministrator"),
  }

  if (await getSession()) redirect("/dashboard")
  if (!(await adminExists())) redirect("/setup")
  const methods = await getAuthMethods()
  const { error, next } = await searchParams
  const safeNext = next && /^\/(?!\/)[\w\-/]*$/.test(next) ? next : "/dashboard"
  return (
    <LoginForm
      local={methods.local}
      sso={methods.oidc ? { name: methods.oidc.displayName } : null}
      publicRegistration={methods.publicRegistration && methods.local}
      canResetPassword={smtpEnabled() && methods.local}
      next={safeNext}
      error={error ? (OAUTH_ERRORS[error] ?? t("login.ssoSignInFailedPleaseTryAgain")) : undefined}
    />
  )
}
