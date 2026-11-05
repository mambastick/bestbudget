import { getTranslations } from "next-intl/server"
import { ListOrdered, Repeat } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { LinkButton } from "@/components/app/link-button"
import { EmptyState } from "@/components/app/empty-state"
import { NavTabs } from "@/components/app/nav-tabs"
import { QuickAddButton } from "@/components/app/operations/quick-add-button"
import { RulesList } from "@/components/app/operations/rules-list"
import { TransactionFilters } from "@/components/app/operations/transaction-filters"
import { TransactionList } from "@/components/app/operations/transaction-list"
import { PageHeader } from "@/components/app/page-header"
import { requireHousehold } from "@/server/session"
import { ensureLoansMaterialized } from "@/server/services/loans"
import { ensureMaterialized, listRules } from "@/server/services/recurring"
import { listPlannedTransactions, listTransactions, transactionFilters } from "@/server/services/transactions"
import { todayIn } from "@/lib/dates"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("transactions")
  return { title: t("title") }
}

type SearchParams = Record<string, string | string[] | undefined>

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const t = await getTranslations("transactions")
  const ctx = await requireHousehold()
  const sp = await searchParams
  const tab = sp.tab === "rules" ? "rules" : "list"
  await ensureMaterialized(ctx.householdId, todayIn(ctx.timezone))
  await ensureLoansMaterialized(ctx, todayIn(ctx.timezone))

  const tabs = (
    <NavTabs
      active={tab}
      tabs={[
        { key: "list", label: t("title"), href: "/transactions" },
        { key: "rules", label: t("recurring"), href: "/transactions?tab=rules" },
        { key: "import", label: t("importStatement"), href: "/transactions/import" },
      ]}
    />
  )

  if (tab === "rules") {
    const rules = await listRules(ctx)
    return (
      <div className="grid grid-cols-1 gap-6">
        <PageHeader title={t("title")} description={t("description")} />
        {tabs}
        {rules.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title={t("noRecurring")}
            description={t("noRecurringHint")}
            action={<QuickAddButton label={t("addRecurring")} />}
          />
        ) : (
          <RulesList
            rules={rules.map((r) => ({
              rule: {
                id: r.rule.id,
                type: r.rule.type,
                title: r.rule.title,
                description: r.rule.description,
                amount: r.rule.amount,
                toAmount: r.rule.toAmount,
                categoryId: r.rule.categoryId,
                accountId: r.rule.accountId,
                toAccountId: r.rule.toAccountId,
                frequency: r.rule.frequency,
                interval: r.rule.interval,
                dayOfMonth: r.rule.dayOfMonth,
                startDate: r.rule.startDate,
                endDate: r.rule.endDate,
                version: r.rule.version,
              },
              categoryIcon: r.categoryIcon,
              categoryColor: r.categoryColor,
              categoryName: r.categoryName,
              accountName: r.accountName,
              finished: r.finished,
              nextDate: r.nextDate,
            }))}
          />
        )}
      </div>
    )
  }

  const parsed = transactionFilters.safeParse(Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "tab" && typeof v === "string" && v !== "")))
  const filters = parsed.success ? parsed.data : transactionFilters.parse({})
  const [list, planned] = await Promise.all([
    listTransactions(ctx, { ...filters, status: filters.status ?? "posted" }),
    !filters.status && filters.page === 1 ? listPlannedTransactions(ctx, filters) : null,
  ])
  const { rows, hasMore, page } = list
  const filtered = Boolean(filters.q || filters.type || filters.status || filters.categoryId || filters.accountId || filters.from || filters.to)

  const pageHref = (p: number) => {
    const params = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"))
    params.set("page", String(p))
    return `/transactions?${params}`
  }
  const plannedParams = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"))
  plannedParams.set("status", "planned")
  plannedParams.delete("page")
  const heading = filters.status === "planned" ? "plannedHeading" : filters.status === "skipped" ? "skippedHeading" : "postedHeading"
  const pagination = page > 1 || hasMore ? (
    <div className="flex justify-center gap-2">
      {page > 1 ? <LinkButton variant="outline" href={pageHref(page - 1)}>{t("back")}</LinkButton> : null}
      {hasMore ? <LinkButton variant="outline" href={pageHref(page + 1)}>{t("next")}</LinkButton> : null}
    </div>
  ) : null

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      {tabs}
      <TransactionFilters />
      {planned && planned.rows.length > 0 ? (
        <section aria-labelledby="planned-heading" className="grid min-w-0 gap-3">
          <h2 id="planned-heading" className="text-lg font-semibold">{t("plannedHeading")}</h2>
          <TransactionList rows={planned.rows} today={todayIn(ctx.timezone)} showNet={false} />
          {planned.total > planned.rows.length ? (
            <Link href={`/transactions?${plannedParams}`} className="w-fit text-sm font-medium text-primary hover:underline">
              {t("showAllPlanned", { count: planned.total })}
            </Link>
          ) : null}
        </section>
      ) : null}
      {rows.length === 0 && !planned?.rows.length ? (
        <EmptyState
          icon={ListOrdered}
          title={filtered ? t("noResults") : t("noTransactions")}
          description={filtered ? t("noResultsHint") : t("noTransactionsHint")}
          action={filtered ? undefined : <QuickAddButton label={t("addTransaction")} />}
        />
      ) : null}
      {rows.length > 0 ? (
        <section aria-labelledby="transactions-heading" className="grid min-w-0 gap-3">
          <h2 id="transactions-heading" className="text-lg font-semibold">{t(heading)}</h2>
          <TransactionList rows={rows} today={todayIn(ctx.timezone)} showNet={filters.status !== "planned"} />
          {pagination}
        </section>
      ) : pagination}
    </div>
  )
}
