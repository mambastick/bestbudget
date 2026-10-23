import { AuthPreferences } from "@/components/app/preferences"
import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { PiggyBank } from "lucide-react"
import { redirect } from "next/navigation"
import { OnboardingForm } from "@/components/auth/onboarding-form"
import { requireUser } from "@/server/session"
import { listMemberships } from "@/server/services/households"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding")
  return { title: t("onboarding.household") }
}

// Always rendered per request: depends on the session and database.
export const dynamic = "force-dynamic"

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser()
  const memberships = await listMemberships(user.id)
  const isNew = (await searchParams).new === "1"
  if (memberships.length > 0 && !isNew) redirect("/dashboard")
  return (
    <div data-slot="auth-layout" className="flex min-h-svh flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_60%)] px-4 pt-16 pb-10">
      <AuthPreferences />
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <PiggyBank className="size-5" />
        </span>
        BestBudget
      </div>
      <div className="w-full max-w-md">
        <OnboardingForm userName={user.name} canCancel={memberships.length > 0} />
      </div>
    </div>
  )
}
