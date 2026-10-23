"use client"

import { useTranslations, useLocale } from "next-intl"

import { useOperations } from "@/components/app/operations/operations-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { LoanScheduleRow } from "@/domain/loan"
import { formatDateFull } from "@/lib/dates"
import { formatMoney } from "@/lib/money"

type Row = LoanScheduleRow & { status?: string }

export function LoanSchedule({
  rows,
  currency,
  today,
  loanId,
  closed = false,
}: {
  rows: Row[]
  currency: string
  today: string
  loanId?: string
  closed?: boolean
}) {
  const t = useTranslations("loans")
  const locale = useLocale()
  const ops = useOperations()
  const label = (r: Row) =>
    r.kind === "prepayment"
      ? t("status.prepayment")
      : r.kind === "reconciliation"
        ? t("status.reconciliation")
        : r.status === "posted"
          ? t("status.paid")
          : r.status === "skipped"
            ? t("status.reconciled")
            : closed
              ? t("status.closed")
              : r.date < today
                ? t("status.overdue")
                : t("status.planned")
  const action = (r: Row) =>
    loanId && !closed && r.kind === "scheduled" && (!r.status || r.status === "planned") ? (
      <Button size="sm" variant="outline" onClick={() => ops.openLoan(loanId, r.date)}>
        {t("actions.confirm")}
      </Button>
    ) : null
  return (
    <>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("schedule.numberDate")}</TableHead>
              <TableHead>{t("schedule.payment")}</TableHead>
              <TableHead>{t("schedule.interest")}</TableHead>
              <TableHead>{t("schedule.principal")}</TableHead>
              <TableHead>{t("schedule.balance")}</TableHead>
              <TableHead>{t("schedule.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.date}:${r.kind}:${i}`}>
                <TableCell>
                  {r.n} · {formatDateFull(r.date, locale)}
                </TableCell>
                <TableCell>{formatMoney(r.payment, currency, { locale })}</TableCell>
                <TableCell>{formatMoney(r.interest, currency, { locale })}</TableCell>
                <TableCell>{formatMoney(r.principal, currency, { locale })}</TableCell>
                <TableCell>{formatMoney(r.balance, currency, { locale })}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{label(r)}</Badge>
                    {action(r)}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:hidden">
        {rows.map((r, i) => (
          <li key={`${r.date}:${r.kind}:${i}`} className="min-w-0 rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {r.n} · {formatDateFull(r.date, locale)}
              </span>
              <Badge variant="outline">{label(r)}</Badge>
            </div>
            <dl className="my-3 grid grid-cols-2 gap-2 text-xs">
              {[
                [t("schedule.payment"), r.payment],
                [t("schedule.interest"), r.interest],
                [t("schedule.principal"), r.principal],
                [t("schedule.balance"), r.balance],
              ].map(([title, value]) => (
                <div key={title} className="min-w-0">
                  <dt className="text-muted-foreground">{title}</dt>
                  <dd className="mt-1 font-medium break-words">{formatMoney(value as number, currency, { locale })}</dd>
                </div>
              ))}
            </dl>
            {action(r)}
          </li>
        ))}
      </ul>
    </>
  )
}
