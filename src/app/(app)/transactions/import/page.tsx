import type { Metadata } from "next"
import { ImportWizard } from "@/components/app/import/import-wizard"
import { ImportPreview } from "@/components/app/import/import-preview"
import { ImportHistory } from "@/components/app/import/import-history"
import { NavTabs } from "@/components/app/nav-tabs"
import { PageHeader } from "@/components/app/page-header"
import { requireHousehold } from "@/server/session"
import { listAccounts, listCategories } from "@/server/services/catalog"
import { getImport, listImportProfiles, listImports, reconcileBalances } from "@/server/services/imports"

export const metadata: Metadata = { title: "Импорт выписки" }

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const ctx = await requireHousehold()
  const { batch: batchId } = await searchParams
  const [accounts, categories, profiles, history] = await Promise.all([
    listAccounts(ctx),
    listCategories(ctx),
    listImportProfiles(ctx),
    listImports(ctx),
  ])
  const current = batchId ? await getImport(ctx, batchId) : null
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <PageHeader title="Импорт выписки" description="CSV и XLSX · до 10 МБ и 50 000 строк" />
      <NavTabs
        active="import"
        tabs={[
          { key: "list", label: "Операции", href: "/transactions" },
          { key: "rules", label: "Регулярные", href: "/transactions?tab=rules" },
          { key: "import", label: "Импорт", href: "/transactions/import" },
        ]}
      />
      {current ? (
        <ImportPreview
          {...current}
          categories={categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
          accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
          reconciliation={reconcileBalances(current.rows)}
        />
      ) : (
        <ImportWizard accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))} profiles={profiles} />
      )}
      <ImportHistory
        batches={history.map((b) => ({
          id: b.id,
          source: b.source,
          status: b.status,
          createdAt: b.createdAt.toISOString(),
          counters: b.counters,
        }))}
      />
    </div>
  )
}
