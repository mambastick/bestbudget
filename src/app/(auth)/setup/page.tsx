import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { SetupForm } from "@/components/auth/setup-form"
import { env } from "@/lib/env"
import { adminExists } from "@/server/services/users"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth")
  return { title: t("setup.initialSetup") }
}
export const dynamic = "force-dynamic"

export default async function SetupPage() {
  if (await adminExists()) redirect("/login")
  return <SetupForm tokenConfigured={Boolean(env().SETUP_TOKEN)} />
}
