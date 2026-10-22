"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { toast } from "sonner"
import { confirmTransactionAction, getRuleAction, materializeOccurrenceAction } from "@/app/actions/finance"
import { DateField } from "@/components/app/date-field"
import { MoneyInput } from "@/components/app/money-input"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { useAction } from "@/hooks/use-action"
import type { IsoDate } from "@/lib/dates"
import { formatMoney, minorToInput, parseMoney } from "@/lib/money"
import { useCatalog } from "./catalog-context"
import { OperationDialog, type OperationDialogMode } from "./operation-dialog"
import type { OperationRow, OperationType, RuleRow } from "./types"

interface OperationsApi {
  openCreate: (defaults?: { type?: OperationType; date?: IsoDate }) => void
  openEdit: (row: OperationRow) => void
  openRule: (rule: RuleRow) => void
  openConfirm: (row: OperationRow) => void
  /** Projected occurrences have no row yet: create it, then edit or confirm. */
  openVirtual: (ruleId: string, date: IsoDate, then: "edit" | "confirm") => void
}

const OperationsContext = createContext<OperationsApi | null>(null)

export function useOperations() {
  const ctx = useContext(OperationsContext)
  if (!ctx) throw new Error("useOperations must be used inside OperationsProvider")
  return ctx
}

function toRow(r: OperationRow): OperationRow {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    amount: r.amount,
    title: r.title,
    description: r.description,
    date: r.date,
    occurrenceDate: r.occurrenceDate,
    categoryId: r.categoryId,
    accountId: r.accountId,
    toAccountId: r.toAccountId,
    recurringRuleId: r.recurringRuleId,
    version: r.version,
  }
}

export function OperationsProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<OperationDialogMode | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmRow, setConfirmRow] = useState<OperationRow | null>(null)

  const openEdit = useCallback(async (row: OperationRow) => {
    let rule: RuleRow | null = null
    if (row.recurringRuleId) {
      const res = await getRuleAction(row.recurringRuleId)
      if (res.ok) rule = res.data
    }
    setMode({ kind: "transaction", row: toRow(row), rule })
    setOpen(true)
  }, [])

  const api = useMemo<OperationsApi>(
    () => ({
      openCreate: (defaults) => {
        setMode({ kind: "create", ...defaults })
        setOpen(true)
      },
      openEdit: (row) => void openEdit(row),
      openRule: (rule) => {
        setMode({ kind: "rule", rule })
        setOpen(true)
      },
      openConfirm: (row) => setConfirmRow(toRow(row)),
      openVirtual: async (ruleId, date, then) => {
        const res = await materializeOccurrenceAction(ruleId, date)
        if (!res.ok) return void toast.error(res.error)
        if (then === "confirm") setConfirmRow(toRow(res.data))
        else void openEdit(res.data)
      },
    }),
    [openEdit],
  )

  return (
    <OperationsContext.Provider value={api}>
      {children}
      {mode ? <OperationDialog mode={mode} open={open} onOpenChange={setOpen} /> : null}
      <ConfirmOperationDialog row={confirmRow} onClose={() => setConfirmRow(null)} />
    </OperationsContext.Provider>
  )
}

/** Confirms a planned operation, optionally with the actual amount and date. */
function ConfirmOperationDialog({ row, onClose }: { row: OperationRow | null; onClose: () => void }) {
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">{row ? <ConfirmForm key={row.id} row={row} onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  )
}

function ConfirmForm({ row, onClose }: { row: OperationRow; onClose: () => void }) {
  const { today, currency } = useCatalog()
  const [amount, setAmount] = useState(minorToInput(row.amount))
  const [date, setDate] = useState<IsoDate>(row.date > today ? today : row.date)
  const { pending, run } = useAction()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = parseMoney(amount)
    if (!value) return void toast.error("Укажите сумму")
    run(() => confirmTransactionAction(row.id, { version: row.version, amount: value, date }), {
      success: "Операция подтверждена",
      onSuccess: onClose,
    })
  }

  const verb = row.type === "income" ? "получение" : row.type === "expense" ? "оплату" : "перевод"
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>Подтвердить {verb}</DialogTitle>
        <DialogDescription>
          «{row.title}», план: {formatMoney(row.amount, currency)}. Укажите фактическую сумму и дату — после подтверждения она войдёт в
          фактический баланс.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="confirm-amount">Фактическая сумма</FieldLabel>
        <MoneyInput id="confirm-amount" value={amount} onChange={setAmount} />
      </Field>
      <Field>
        <FieldLabel>Фактическая дата</FieldLabel>
        <DateField value={date} onChange={(d) => d && setDate(d)} today={today} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Сохранение…" : "Подтвердить"}
        </Button>
      </DialogFooter>
    </form>
  )
}
