import { getTranslations } from "next-intl/server"
import { Target } from "lucide-react"
import { EmptyState } from "@/components/app/empty-state"
import { LinkButton } from "@/components/app/link-button"
import { Section } from "@/components/app/settings/section"
import type { HouseholdCtx } from "@/server/context"
import { listGoals } from "@/server/services/goals"
import { GoalCard } from "./goal-card"

export async function GoalsWidget({ ctx }: { ctx: HouseholdCtx }) {
  const t = await getTranslations("goals")
  const { goals } = await listGoals(ctx)
  const active = goals.filter((g) => g.status !== "archived").slice(0, 3)
  return (
    <Section
      title={t("page.title")}
      description={t("widget.description")}
      action={
        <LinkButton href="/goals" variant="ghost" size="sm">
          {t("page.all")}
        </LinkButton>
      }
    >
      {active.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {active.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </div>
      ) : (
        <EmptyState icon={Target} title={t("view.emptyTitle")} description={t("widget.empty")} />
      )}
    </Section>
  )
}
