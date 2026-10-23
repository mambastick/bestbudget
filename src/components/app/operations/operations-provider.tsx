"use client"

import { useTranslations, useLocale } from "next-intl"
import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { LoanConfirmForm } from "@/components/app/loans/loan-confirm-form"
import { materializeLoanPaymentAction } from "@/app/actions/loans"
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
  openLoan: (loanId: string, date: string) => void
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
    loanId: r.loanId, loanPrincipal: r.loanPrincipal, loanInterest: r.loanInterest, loanPart: r.loanPart,
    id: r.id,
    type: r.type,
    status: r.status,
    amount: r.amount,
    toAmount: r.toAmount,
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
  const router = useRouter()
  const [mode, setMode] = useState<OperationDialogMode | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmRow, setConfirmRow] = useState<OperationRow | null>(null)

  const openEdit = useCallback(async (row: OperationRow) => {
    if (row.loanId) {
      if (row.status === "planned") setConfirmRow(toRow(row))
      else router.push(`/loans/${row.loanId}`)
      return
    }
    let rule: RuleRow | null = null
    if (row.recurringRuleId) {
      const res = await getRuleAction(row.recurringRuleId)
      if (res.ok) rule = res.data
    }
    setMode({ kind: "transaction", row: toRow(row), rule })
    setOpen(true)
  }, [router])

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
      openLoan: async (loanId, date) => {
        const res = await materializeLoanPaymentAction(loanId, date)
        if (!res.ok) return void toast.error(res.error)
        setConfirmRow(toRow(res.data))
      },
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
      <DialogContent className="sm:max-w-sm">{row ? row.loanId ? <LoanConfirmForm key={row.id} row={row} onClose={onClose} /> : <ConfirmForm key={row.id} row={row} onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  )
}

function ConfirmForm({ row, onClose }: { row: OperationRow; onClose: () => void }) {
  const t = useTranslations("transactions")
  const locale = useLocale()
  const { today, accounts } = useCatalog()
  const currency = accounts.find((a) => a.id === row.accountId)!.currency
  const toCurrency = accounts.find((a) => a.id === row.toAccountId)?.currency
  const [amount, setAmount] = useState(minorToInput(row.amount, currency, locale))
  const [toAmount, setToAmount] = useState(row.toAmount && toCurrency ? minorToInput(row.toAmount, toCurrency, locale) : "")
  const [date, setDate] = useState<IsoDate>(row.date > today ? today : row.date)
  const { pending, run } = useAction()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = parseMoney(amount, currency)
    if (!value) return void toast.error(t("enterAmount"))
    const credited = toCurrency && toCurrency !== currency ? parseMoney(toAmount, toCurrency) : undefined
    if (credited === null || credited === 0) return void toast.error(t("enterCredited"))
    run(() => confirmTransactionAction(row.id, { version: row.version, amount: value, toAmount: credited, date }), {
      success: t("confirmed"),
      onSuccess: onClose,
    })
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>{t(`confirmTitle.${row.type}`)}</DialogTitle>
        <DialogDescription>
          {t("confirmHint", { title: row.title, amount: formatMoney(row.amount, currency, { locale }) })}
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="confirm-amount">{t("actualAmount")}</FieldLabel>
        <MoneyInput currency={currency} id="confirm-amount" value={amount} onChange={setAmount} />
      </Field>
      {toCurrency && toCurrency !== currency ? <Field>
        <FieldLabel htmlFor="confirm-to-amount">{t("credited")}</FieldLabel>
        <MoneyInput id="confirm-to-amount" currency={toCurrency} value={toAmount} onChange={setToAmount} />
      </Field> : null}
      <Field>
        <FieldLabel>{t("actualDate")}</FieldLabel>
        <DateField value={date} onChange={(d) => d && setDate(d)} today={today} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("confirm")}
        </Button>
      </DialogFooter>
    </form>
  )
}
