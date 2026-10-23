import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { FxWarnings } from "@/components/app/fx-warnings"
import { GoalsView } from "@/components/app/goals/goals-view"
import { PageHeader } from "@/components/app/page-header"
import { can } from "@/domain/permissions"
import { requireHousehold } from "@/server/session"
import { listAccounts } from "@/server/services/catalog"
import { listGoals } from "@/server/services/goals"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("goals")
  return { title: t("page.title") }
}

export default async function GoalsPage() {
  const t = await getTranslations("goals")
  const ctx = await requireHousehold()
  const [data, accounts] = await Promise.all([listGoals(ctx), listAccounts(ctx, { includeArchived: true })])
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} />
      <FxWarnings warnings={data.warnings} canManageRates={ctx.user.role === "admin"} />
      <GoalsView
        goals={data.goals}
        accounts={accounts}
        today={data.today}
        currency={ctx.currency}
        canWrite={can(ctx.role, "finance.write")}
      />
    </div>
  )
}
