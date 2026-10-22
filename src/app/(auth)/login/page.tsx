import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { LoginForm } from "@/components/auth/login-form"
import { smtpEnabled } from "@/lib/mail"
import { getSession } from "@/server/session"
import { getAuthMethods } from "@/server/services/settings"
import { adminExists } from "@/server/services/users"

export const metadata: Metadata = { title: "Вход" }

const OAUTH_ERRORS: Record<string, string> = {
  signup_disabled: "Регистрация закрыта. Попросите администратора или участника семьи прислать приглашение.",
  unable_to_create_user: "Регистрация закрыта. Попросите администратора или участника семьи прислать приглашение.",
  account_not_linked: "Аккаунт с таким e-mail уже существует. Войдите по паролю и привяжите SSO в настройках безопасности.",
  email_not_verified: "Провайдер не подтвердил ваш e-mail.",
  banned: "Аккаунт заблокирован администратором.",
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
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
      error={error ? (OAUTH_ERRORS[error] ?? "Не удалось войти через SSO. Попробуйте ещё раз.") : undefined}
    />
  )
}
