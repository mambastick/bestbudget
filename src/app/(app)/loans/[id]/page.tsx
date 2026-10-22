import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { LoanDetail } from "@/components/app/loans/loan-detail"
import { PageHeader } from "@/components/app/page-header"
import { can } from "@/domain/permissions"
import { todayIn } from "@/lib/dates"
import { AppError } from "@/server/errors"
import { requireHousehold } from "@/server/session"
import { ensureLoansMaterialized, getLoan } from "@/server/services/loans"

export const metadata: Metadata = { title: "График кредита" }

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireHousehold()
  const today = todayIn(ctx.timezone)
  await ensureLoansMaterialized(ctx, today)
  const data = await getLoan(ctx, (await params).id).catch((e: unknown) => {
    if (e instanceof AppError && e.code === "not_found") notFound()
    throw e
  })
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <PageHeader title={data.name} description="График, история платежей и симулятор досрочного погашения" />
      <LoanDetail data={data} today={today} canManage={can(ctx.role, "loans.manage")} />
    </div>
  )
}
