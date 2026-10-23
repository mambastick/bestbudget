import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { ResetPasswordForm } from "@/components/auth/password-reset"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth")
  return { title: t("resetPassword.newPassword") }
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams
  return <ResetPasswordForm token={token ?? null} invalid={Boolean(error)} />
}
