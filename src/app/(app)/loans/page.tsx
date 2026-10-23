import { getTranslations, getLocale } from "next-intl/server"
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
import { formatMoney } from "@/lib/money"
import { formatDateFull } from "@/lib/dates"
import { requireHousehold } from "@/server/session"
import { listLoans } from "@/server/services/loans"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("loans")
  return { title: t("page.title") }
}

export default async function LoansPage() {
  const t = await getTranslations("loans")
  const locale = await getLocale()
  const ctx = await requireHousehold()
  const rows = await listLoans(ctx)
  const canManage = can(ctx.role, "loans.manage")
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        actions={
          canManage ? (
            <LinkButton href="/loans/new">
              <Plus /> {t("page.add")}
            </LinkButton>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={Landmark} title={t("page.emptyTitle")} description={t("page.emptyDescription")} />
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
                    <Badge variant="outline">{d.loan.status === "active" ? t("status.active") : t("status.closed")}</Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground break-words">
                    {d.loan.lender} ·{" "}
                    {Number(d.events.filter((e) => e.type === "rate_change").at(-1)?.annualRate ?? d.loan.annualRate).toLocaleString(
                      locale,
                      { maximumFractionDigits: 6 },
                    )}
                    %
                  </p>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">{t("summary.balance")}</p>
                    <Money className="text-2xl font-semibold" value={d.debt} currency={d.currency} />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-muted-foreground">{t("summary.nextPayment")}</p>
                      {d.next ? (
                        <>
                          <Money value={d.next.payment} currency={d.currency} />
                          <p className="text-xs text-muted-foreground">{formatDateFull(d.next.date, locale)}</p>
                        </>
                      ) : (
                        t("summary.none")
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{t("summary.payoffDate")}</p>
                      {d.payoffDate ? formatDateFull(d.payoffDate, locale) : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                      <span>{t("summary.principalPaid")}</span>
                      <span>{progress}%</span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={t("summary.progress")}
                      aria-valuenow={progress}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-2 overflow-hidden rounded-full bg-muted"
                    >
                      <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("summary.interestTotal", { amount: formatMoney(d.paidInterest + d.futureInterest, d.currency, { locale }) })}
                  </p>
                  <LinkButton variant="outline" href={`/loans/${d.loan.id}`}>
                    {t("summary.open")}
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
