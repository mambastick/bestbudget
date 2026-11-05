"use client"

import { useTranslations } from "next-intl"
import { deleteTransactionAction } from "@/app/actions/finance"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { useAction } from "@/hooks/use-action"
import type { OperationRow } from "./types"

/** Shared deletion semantics for row menus and the operation editor. */
export function TransactionDeleteDialog({ row, open, onOpenChange, onDeleted }: {
  row: Pick<OperationRow, "id" | "recurringRuleId">
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
}) {
  const t = useTranslations("transactions")
  const { run } = useAction()
  const recurring = row.recurringRuleId !== null
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("deleteTitle")}
      description={recurring ? t("deleteRecurringHint") : t("deleteHint")}
      onConfirm={() => run(() => deleteTransactionAction(row.id), {
        success: recurring ? t("skippedToast") : t("deleted"),
        onSuccess: onDeleted,
      })}
    />
  )
}
