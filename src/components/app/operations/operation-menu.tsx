"use client"

import { useTranslations } from "next-intl"
import { Check, MoreHorizontal, Pencil, RotateCcw, SkipForward, Trash2 } from "lucide-react"
import { useState } from "react"
import { deleteTransactionAction, skipTransactionAction, unconfirmTransactionAction } from "@/app/actions/finance"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAction } from "@/hooks/use-action"
import { useOperations } from "./operations-provider"
import type { OperationRow } from "./types"

/** Row actions: confirm, edit, skip, return to plan, delete. */
export function OperationMenu({ row }: { row: OperationRow }) {
  const t = useTranslations("transactions")
  const ops = useOperations()
  const { run } = useAction()
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (row.loanId) return row.status === "planned" ? <Button variant="ghost" size="icon-sm" aria-label={t("confirmPayment")} onClick={() => ops.openConfirm(row)}><Check /></Button> : null
  const recurring = row.recurringRuleId !== null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("actions")} />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {row.status === "planned" ? (
            <DropdownMenuItem onClick={() => ops.openConfirm(row)}>
              <Check /> {t("confirmPosted")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => ops.openEdit(row)}>
            <Pencil /> {t("edit")}{recurring ? "…" : ""}
          </DropdownMenuItem>
          {recurring && row.status === "planned" ? (
            <DropdownMenuItem onClick={() => run(() => skipTransactionAction(row.id, row.version), { success: t("skippedToast") })}>
              <SkipForward /> {t("skip")}
            </DropdownMenuItem>
          ) : null}
          {row.status !== "planned" ? (
            <DropdownMenuItem onClick={() => run(() => unconfirmTransactionAction(row.id, row.version), { success: t("returnedToPlan") })}>
              <RotateCcw /> {t("returnToPlan")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("deleteTitle")}
        description={
          recurring
            ? t("deleteRecurringHint")
            : t("deleteHint")
        }
        onConfirm={() => run(() => deleteTransactionAction(row.id), { success: recurring ? t("skippedToast") : t("deleted") })}
      />
    </>
  )
}
