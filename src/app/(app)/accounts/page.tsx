import type { Metadata } from "next"
import { AccountsView } from "@/components/app/accounts-view"
import { PageHeader } from "@/components/app/page-header"
import { can } from "@/domain/permissions"
import { requireHousehold } from "@/server/session"
import { listAccounts } from "@/server/services/catalog"

export const metadata: Metadata = { title: "Счета" }

export default async function AccountsPage() {
  const ctx = await requireHousehold()
  const accounts = await listAccounts(ctx, { includeArchived: true })
  return (
    <div className="grid gap-6">
      <PageHeader title="Счета" description="Где лежат деньги: карты, наличные, накопления" />
      <AccountsView
        accounts={accounts.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
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
