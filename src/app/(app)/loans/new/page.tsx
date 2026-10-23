import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { LoanWizard } from "@/components/app/loans/loan-wizard"
import { PageHeader } from "@/components/app/page-header"
import { can } from "@/domain/permissions"
import { requireHousehold } from "@/server/session"

export const metadata: Metadata = { title: "Новый кредит" }

export default async function NewLoanPage() {
  const ctx = await requireHousehold()
  if (!can(ctx.role, "loans.manage")) redirect("/loans")
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Добавить кредит" description="Новый кредит или учёт текущего долга с середины срока" />
      <LoanWizard />
    </div>
  )
}
