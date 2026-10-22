import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { RegisterForm } from "@/components/auth/register-form"
import { getSession } from "@/server/session"
import { getAuthMethods } from "@/server/services/settings"

export const metadata: Metadata = { title: "Регистрация" }

export default async function RegisterPage() {
  if (await getSession()) redirect("/dashboard")
  const methods = await getAuthMethods()
  if (!methods.publicRegistration || !methods.local) redirect("/login")
  return <RegisterForm />
}
