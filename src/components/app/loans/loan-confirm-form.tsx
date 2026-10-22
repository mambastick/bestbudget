"use client"

import { useState } from "react"
import { toast } from "sonner"
import { confirmLoanPaymentAction } from "@/app/actions/loans"
import { DateField } from "@/components/app/date-field"
import { MoneyInput } from "@/components/app/money-input"
import { useCatalog } from "@/components/app/operations/catalog-context"
import type { OperationRow } from "@/components/app/operations/types"
import { Segmented } from "@/components/app/segmented"
import { Button } from "@/components/ui/button"
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { useAction } from "@/hooks/use-action"
import { formatMoney, minorToInput, parseMoney } from "@/lib/money"

export function LoanConfirmForm({ row, onClose }: { row: OperationRow; onClose: () => void }) {
  const { today, accounts } = useCatalog()
  const currency = accounts.find((a) => a.id === row.accountId)!.currency
  const [amount, setAmount] = useState(minorToInput(row.amount, currency))
  const [principal, setPrincipal] = useState(minorToInput(row.loanPrincipal ?? 0, currency))
  const [date, setDate] = useState(row.date > today ? today : row.date)
  const [allocation, setAllocation] = useState<"principal" | "interest" | "manual">("principal")
  const { run, pending } = useAction()
  const total = parseMoney(amount, currency)
  const body =
    allocation === "manual"
      ? parseMoney(principal, currency)
      : allocation === "principal"
        ? (total ?? 0) - (row.loanInterest ?? 0)
        : (row.loanPrincipal ?? 0)
  const interest = (total ?? 0) - (body ?? 0)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!total || body === null || body < 0 || interest < 0) return void toast.error("Проверьте сумму и разбивку платежа")
    run(() => confirmLoanPaymentAction(row.id, { version: row.version, date, amount: total, allocation, principal: body }), {
      success: "Платёж по кредиту подтверждён",
      onSuccess: onClose,
    })
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>Подтвердить платёж по кредиту</DialogTitle>
        <DialogDescription>
          {row.title}. План: {formatMoney(row.amount, currency)} (тело {formatMoney(row.loanPrincipal ?? 0, currency)} + проценты{" "}
          {formatMoney(row.loanInterest ?? 0, currency)}).
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="loan-confirm-amount">Фактическая сумма</FieldLabel>
        <MoneyInput id="loan-confirm-amount" currency={currency} value={amount} onChange={setAmount} />
      </Field>
      <Field>
        <FieldLabel>Разницу отнести</FieldLabel>
        <Segmented
          value={allocation}
          onChange={setAllocation}
          size="sm"
          options={[
            { value: "principal", label: "В тело" },
            { value: "interest", label: "В проценты" },
            { value: "manual", label: "Вручную" },
          ]}
        />
      </Field>
      {allocation === "manual" ? (
        <Field>
          <FieldLabel htmlFor="loan-confirm-principal">Тело платежа</FieldLabel>
          <MoneyInput id="loan-confirm-principal" currency={currency} value={principal} onChange={setPrincipal} />
        </Field>
      ) : null}
      <p className="text-sm" aria-live="polite">
        Тело: {formatMoney(body ?? 0, currency)} · проценты: {formatMoney(interest, currency)}
      </p>
      <Field>
        <FieldLabel htmlFor="loan-confirm-date">Фактическая дата</FieldLabel>
        <DateField id="loan-confirm-date" value={date} onChange={(d) => d && setDate(d)} today={today} />
      </Field>
      <p className="text-xs text-muted-foreground">
        Обе части подтвердятся вместе. Изменение тела пересчитает будущий график с прежним платежом.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" disabled={pending}>
          Подтвердить
        </Button>
      </DialogFooter>
    </form>
  )
}
