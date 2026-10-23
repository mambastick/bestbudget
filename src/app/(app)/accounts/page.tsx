import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { AccountsView } from "@/components/app/accounts-view"
import { PageHeader } from "@/components/app/page-header"
import { can } from "@/domain/permissions"
import { requireHousehold } from "@/server/session"
import { listAccounts } from "@/server/services/catalog"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounts")
  return { title: t("page.title") }
}

export default async function AccountsPage() {
  const t = await getTranslations("accounts")
  const ctx = await requireHousehold()
  const accounts = await listAccounts(ctx, { includeArchived: true })
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title={t("page.title")} description={t("page.description")} />
      <AccountsView
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          version: a.version,
          currency: a.currency,
          currencyLocked: a.currencyLocked,
          creditLimit: a.creditLimit,
          openingBalance: a.openingBalance,
          balance: a.balance,
          operations: a.operations,
          archived: a.archivedAt !== null,
        }))}
        canManage={can(ctx.role, "catalog.manage")}
        currency={ctx.currency}
      />
    </div>
  )
}
