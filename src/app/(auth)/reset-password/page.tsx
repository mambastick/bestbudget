import type { Metadata } from "next"
import { ResetPasswordForm } from "@/components/auth/password-reset"

export const metadata: Metadata = { title: "Новый пароль" }

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams
  return <ResetPasswordForm token={token ?? null} invalid={Boolean(error)} />
}
