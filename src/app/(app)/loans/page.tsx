import { Landmark, Plus } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { EmptyState } from "@/components/app/empty-state"
import { LinkButton } from "@/components/app/link-button"
import { Money } from "@/components/app/money"
import { PageHeader } from "@/components/app/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { can } from "@/domain/permissions"
import { formatDateFull } from "@/lib/dates"
import { requireHousehold } from "@/server/session"
import { listLoans } from "@/server/services/loans"

export const metadata: Metadata = { title: "Кредиты" }

export default async function LoansPage() {
  const ctx = await requireHousehold()
  const rows = await listLoans(ctx)
  const canManage = can(ctx.role, "loans.manage")
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Кредиты"
        description="Основной долг, проценты и графики погашения"
        actions={
          canManage ? (
            <LinkButton href="/loans/new">
              <Plus /> Добавить кредит
            </LinkButton>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="Кредитов пока нет"
          description="Добавьте новый кредит или текущий долг с оставшимся сроком. График вводится вручную и сверяется с банком."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rows.map((d) => {
            const progress = Math.max(0, Math.min(100, Math.round((1 - d.debt / d.loan.principal) * 100)))
            return (
              <Card key={d.loan.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                    <Link className="break-words hover:underline" href={`/loans/${d.loan.id}`}>
                      {d.name}
                    </Link>
                    <Badge variant="outline">{d.loan.status === "active" ? "Активен" : "Закрыт"}</Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground break-words">
                    {d.loan.lender} ·{" "}
                    {Number(d.events.filter((e) => e.type === "rate_change").at(-1)?.annualRate ?? d.loan.annualRate).toLocaleString(
                      "ru-RU",
                      { maximumFractionDigits: 6 },
                    )}
                    %
                  </p>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Остаток долга</p>
                    <Money className="text-2xl font-semibold" value={d.debt} currency={d.currency} />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Следующий платёж</p>
                      {d.next ? (
                        <>
                          <Money value={d.next.payment} currency={d.currency} />
                          <p className="text-xs text-muted-foreground">{formatDateFull(d.next.date)}</p>
                        </>
                      ) : (
                        "Нет"
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Дата погашения</p>
                      {d.payoffDate ? formatDateFull(d.payoffDate) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                      <span>Выплачено основного долга</span>
                      <span>{progress}%</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label="Прогресс выплаты"
                      aria-valuenow={progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-2 overflow-hidden rounded-full bg-muted"
                    >
                      <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Переплата с начала учёта: <Money value={d.paidInterest + d.futureInterest} currency={d.currency} /> (выплаченные +
                    будущие проценты)
                  </p>
                  <LinkButton variant="outline" href={`/loans/${d.loan.id}`}>
                    График и досрочка
                  </LinkButton>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
