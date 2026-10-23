import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { LoanWizard } from "@/components/app/loans/loan-wizard"
import { PageHeader } from "@/components/app/page-header"
import { can } from "@/domain/permissions"
import { requireHousehold } from "@/server/session"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("loans")
  return { title: t("page.new") }
}

export default async function NewLoanPage() {
  const t = await getTranslations("loans")
  const ctx = await requireHousehold()
  if (!can(ctx.role, "loans.manage")) redirect("/loans")
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title={t("page.add")} description={t("page.newDescription")} />
      <LoanWizard />
    </div>
  )
}
