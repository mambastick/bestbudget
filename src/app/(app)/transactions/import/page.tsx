import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { ImportWizard } from "@/components/app/import/import-wizard"
import { ImportPreview } from "@/components/app/import/import-preview"
import { ImportHistory } from "@/components/app/import/import-history"
import { NavTabs } from "@/components/app/nav-tabs"
import { PageHeader } from "@/components/app/page-header"
import { requireHousehold } from "@/server/session"
import { listAccounts, listCategories } from "@/server/services/catalog"
import { getImport, listImportProfiles, listImports, reconcileBalances } from "@/server/services/imports"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("import")
  return { title: t("page.title") }
}

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const t = await getTranslations("import")
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
      <PageHeader title={t("page.title")} description={t("page.description")} />
      <NavTabs
        active="import"
        tabs={[
          { key: "list", label: t("nav.transactions"), href: "/transactions" },
          { key: "rules", label: t("nav.recurring"), href: "/transactions?tab=rules" },
          { key: "import", label: t("nav.import"), href: "/transactions/import" },
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
        timeZone={ctx.timezone}
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
