import { AuthPreferences } from "@/components/app/preferences"
import { PiggyBank } from "lucide-react"

// Always rendered per request: depends on the session and database.
export const dynamic = "force-dynamic"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-slot="auth-layout" className="flex min-h-svh flex-col items-center justify-center bg-[radial-gradient(ellipse_at_top,var(--accent),transparent_60%)] px-4 pt-16 pb-10">
      <AuthPreferences />
      <div className="mb-6 flex items-center gap-2 text-lg font-semibold">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <PiggyBank className="size-5" />
        </span>
        BestBudget
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  )
}
