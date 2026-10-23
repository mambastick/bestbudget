import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ForgotPasswordForm } from "@/components/auth/password-reset"
import { smtpEnabled } from "@/lib/mail"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth")
  return { title: t("forgotPassword.resetPassword") }
}

export default function ForgotPasswordPage() {
  if (!smtpEnabled()) redirect("/login")
  return <ForgotPasswordForm />
}
