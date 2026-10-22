import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ForgotPasswordForm } from "@/components/auth/password-reset"
import { smtpEnabled } from "@/lib/mail"

export const metadata: Metadata = { title: "Восстановление доступа" }

export default function ForgotPasswordPage() {
  if (!smtpEnabled()) redirect("/login")
  return <ForgotPasswordForm />
}
