import type { Metadata } from "next"
import { BudgetList } from "@/components/app/budget-list"
import { Money } from "@/components/app/money"
import { MonthSwitcher } from "@/components/app/month-switcher"
import { PageHeader } from "@/components/app/page-header"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { can } from "@/domain/permissions"
import { formatMonth, parseMonthKey, todayIn } from "@/lib/dates"
import { requireHousehold } from "@/server/session"
import { getBudgets } from "@/server/services/budgets"

export const metadata: Metadata = { title: "Бюджеты" }

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireHousehold()
  const today = todayIn(ctx.timezone)
  const month = parseMonthKey((await searchParams).month, today)
  const rows = await getBudgets(ctx, month)
  const limited = rows.filter((r) => r.limit !== null)
  const totalLimit = limited.reduce((s, r) => s + r.limit!, 0)
  const totalSpent = limited.reduce((s, r) => s + r.spent, 0)

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Бюджеты"
        description={`Месячные лимиты по категориям расходов · ${formatMonth(month)}`}
        actions={<MonthSwitcher month={month} today={today} basePath="/budgets" />}
      />
      {limited.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Лимиты на месяц</CardDescription>
              <CardTitle className="text-2xl font-semibold">
                <Money value={totalLimit} currency={ctx.currency} />
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Потрачено по лимитам</CardDescription>
              <CardTitle className="text-2xl font-semibold">
                <Money value={totalSpent} currency={ctx.currency} />
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Остаток</CardDescription>
              <CardTitle className="text-2xl font-semibold">
                <Money value={totalLimit - totalSpent} currency={ctx.currency} tone={totalLimit - totalSpent < 0 ? "expense" : "neutral"} />
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      ) : null}
      <BudgetList rows={rows} canManage={can(ctx.role, "catalog.manage")} />
    </div>
  )
}
