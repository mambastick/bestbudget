import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { FxWarnings } from "@/components/app/fx-warnings"
import { GoalDetail } from "@/components/app/goals/goal-detail"
import { LinkButton } from "@/components/app/link-button"
import { PageHeader } from "@/components/app/page-header"
import { can } from "@/domain/permissions"
import { AppError } from "@/server/errors"
import { requireHousehold } from "@/server/session"
import { listAccounts } from "@/server/services/catalog"
import { getGoalDetail } from "@/server/services/goals"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("goals")
  return { title: t("page.detailTitle") }
}

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("goals")
  const ctx = await requireHousehold()
  const { id } = await params
  const detail = await getGoalDetail(ctx, id).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "not_found") notFound()
    throw e
  })
  const accounts = await listAccounts(ctx, { includeArchived: true })
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title={detail.goal.name}
        description={t("page.detailDescription")}
        actions={
          <LinkButton href="/goals" variant="outline">
            {t("page.all")}
          </LinkButton>
        }
      />
      <FxWarnings warnings={detail.warnings} canManageRates={ctx.user.role === "admin"} />
      <GoalDetail detail={detail} accounts={accounts} canWrite={can(ctx.role, "finance.write")} />
    </div>
  )
}
