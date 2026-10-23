"use client"

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
  const ops = useOperations()
  const label = (r: Row) =>
    r.kind === "prepayment"
      ? "Досрочно"
      : r.kind === "reconciliation"
        ? "Сверка"
        : r.status === "posted"
          ? "Оплачен"
          : r.status === "skipped"
            ? "Сверен"
            : closed
              ? "Закрыт"
              : r.date < today
                ? "Просрочен"
                : "План"
  const action = (r: Row) =>
    loanId && !closed && r.kind === "scheduled" && (!r.status || r.status === "planned") ? (
      <Button size="sm" variant="outline" onClick={() => ops.openLoan(loanId, r.date)}>
        Подтвердить
      </Button>
    ) : null
  return (
    <>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>№ / дата</TableHead>
              <TableHead>Платёж</TableHead>
              <TableHead>Проценты</TableHead>
              <TableHead>Тело</TableHead>
              <TableHead>Остаток</TableHead>
              <TableHead>Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.date}:${r.kind}:${i}`}>
                <TableCell>
                  {r.n} · {formatDateFull(r.date)}
                </TableCell>
                <TableCell>{formatMoney(r.payment, currency)}</TableCell>
                <TableCell>{formatMoney(r.interest, currency)}</TableCell>
                <TableCell>{formatMoney(r.principal, currency)}</TableCell>
                <TableCell>{formatMoney(r.balance, currency)}</TableCell>
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
                {r.n} · {formatDateFull(r.date)}
              </span>
              <Badge variant="outline">{label(r)}</Badge>
            </div>
            <dl className="my-3 grid grid-cols-2 gap-2 text-xs">
              {[
                ["Платёж", r.payment],
                ["Проценты", r.interest],
                ["Тело", r.principal],
                ["Остаток", r.balance],
              ].map(([title, value]) => (
                <div key={title} className="min-w-0">
                  <dt className="text-muted-foreground">{title}</dt>
                  <dd className="mt-1 font-medium break-words">{formatMoney(value as number, currency)}</dd>
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
