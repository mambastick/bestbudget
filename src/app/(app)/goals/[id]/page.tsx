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

export const metadata: Metadata = { title: "Цель" }

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
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
        description="План накоплений семьи"
        actions={
          <LinkButton href="/goals" variant="outline">
            Все цели
          </LinkButton>
        }
      />
      <FxWarnings warnings={detail.warnings} canManageRates={ctx.user.role === "admin"} />
      <GoalDetail detail={detail} accounts={accounts} canWrite={can(ctx.role, "finance.write")} />
    </div>
  )
}
