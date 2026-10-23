import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { RegisterForm } from "@/components/auth/register-form"
import { getSession } from "@/server/session"
import { getAuthMethods } from "@/server/services/settings"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth")
  return { title: t("register.createAnAccount") }
}

export default async function RegisterPage() {
  if (await getSession()) redirect("/dashboard")
  const methods = await getAuthMethods()
  if (!methods.publicRegistration || !methods.local) redirect("/login")
  return <RegisterForm />
}
