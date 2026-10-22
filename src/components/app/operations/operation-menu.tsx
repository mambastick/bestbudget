"use client"

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
  const ops = useOperations()
  const { run } = useAction()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const recurring = row.recurringRuleId !== null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Действия" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {row.status === "planned" ? (
            <DropdownMenuItem onClick={() => ops.openConfirm(row)}>
              <Check /> Подтвердить выполнение
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => ops.openEdit(row)}>
            <Pencil /> Изменить{recurring ? "…" : ""}
          </DropdownMenuItem>
          {recurring && row.status === "planned" ? (
            <DropdownMenuItem onClick={() => run(() => skipTransactionAction(row.id, row.version), { success: "Операция пропущена" })}>
              <SkipForward /> Пропустить
            </DropdownMenuItem>
          ) : null}
          {row.status !== "planned" ? (
            <DropdownMenuItem onClick={() => run(() => unconfirmTransactionAction(row.id, row.version), { success: "Операция возвращена в план" })}>
              <RotateCcw /> Вернуть в план
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Удалить
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Удалить операцию?"
        description={
          recurring
            ? "Операция создана по расписанию: она будет отмечена как пропущенная, остальные операции расписания не изменятся."
            : "Операция будет удалена без возможности восстановления."
        }
        onConfirm={() => run(() => deleteTransactionAction(row.id), { success: recurring ? "Операция пропущена" : "Операция удалена" })}
      />
    </>
  )
}
