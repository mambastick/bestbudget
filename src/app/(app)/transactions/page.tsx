import { ListOrdered, Repeat } from "lucide-react"
import type { Metadata } from "next"
import { LinkButton } from "@/components/app/link-button"
import { EmptyState } from "@/components/app/empty-state"
import { NavTabs } from "@/components/app/nav-tabs"
import { QuickAddButton } from "@/components/app/operations/quick-add-button"
import { RulesList } from "@/components/app/operations/rules-list"
import { TransactionFilters } from "@/components/app/operations/transaction-filters"
import { TransactionList } from "@/components/app/operations/transaction-list"
import { PageHeader } from "@/components/app/page-header"
import { requireHousehold } from "@/server/session"
import { ensureMaterialized, listRules } from "@/server/services/recurring"
import { listTransactions, transactionFilters } from "@/server/services/transactions"
import { todayIn } from "@/lib/dates"

export const metadata: Metadata = { title: "Операции" }

type SearchParams = Record<string, string | string[] | undefined>

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireHousehold()
  const sp = await searchParams
  const tab = sp.tab === "rules" ? "rules" : "list"
  await ensureMaterialized(ctx.householdId, todayIn(ctx.timezone))

  const tabs = (
    <NavTabs
      active={tab}
      tabs={[
        { key: "list", label: "Операции", href: "/transactions" },
        { key: "rules", label: "Регулярные", href: "/transactions?tab=rules" },
      ]}
    />
  )

  if (tab === "rules") {
    const rules = await listRules(ctx)
    return (
      <div className="grid grid-cols-1 gap-6">
        <PageHeader title="Операции" description="Доходы, расходы и переводы" />
        {tabs}
        {rules.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title="Регулярных операций пока нет"
            description="Добавьте зарплату, ипотеку, кредиты, ЖКХ и подписки — включите «Повторять регулярно» при создании операции."
            action={<QuickAddButton label="Добавить регулярную" />}
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
  const { rows, hasMore, page } = await listTransactions(ctx, filters)
  const filtered = Boolean(filters.q || filters.type || filters.status || filters.categoryId || filters.accountId || filters.from || filters.to)

  const pageHref = (p: number) => {
    const params = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"))
    params.set("page", String(p))
    return `/transactions?${params}`
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Операции" description="Доходы, расходы и переводы" />
      {tabs}
      <TransactionFilters />
      {rows.length === 0 ? (
        <EmptyState
          icon={ListOrdered}
          title={filtered ? "Ничего не найдено" : "Операций пока нет"}
          description={filtered ? "Измените условия поиска или сбросьте фильтры." : "Добавьте первый доход или расход."}
          action={filtered ? undefined : <QuickAddButton label="Добавить операцию" />}
        />
      ) : (
        <TransactionList rows={rows} today={todayIn(ctx.timezone)} />
      )}
      {page > 1 || hasMore ? (
        <div className="flex justify-center gap-2">
          {page > 1 ? (
            <LinkButton variant="outline" href={pageHref(page - 1)}>
              Назад
            </LinkButton>
          ) : null}
          {hasMore ? (
            <LinkButton variant="outline" href={pageHref(page + 1)}>
              Дальше
            </LinkButton>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
