import type { Metadata } from "next"
import { PiggyBank } from "lucide-react"
import { redirect } from "next/navigation"
import { OnboardingForm } from "@/components/auth/onboarding-form"
import { requireUser } from "@/server/session"
import { listMemberships } from "@/server/services/households"

export const metadata: Metadata = { title: "Семейное пространство" }

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await requireUser()
  const memberships = await listMemberships(user.id)
  const isNew = (await searchParams).new === "1"
  if (memberships.length > 0 && !isNew) redirect("/dashboard")
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_60%)] px-4 py-10">
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
