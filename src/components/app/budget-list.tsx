"use client"

import { AlertTriangle, CircleCheck, Pencil, Target } from "lucide-react"
import { useState } from "react"
import { setBudgetAction } from "@/app/actions/catalog"
import { CategoryIcon } from "@/components/app/category-icon"
import { EmptyState } from "@/components/app/empty-state"
import { Money } from "@/components/app/money"
import { MoneyInput } from "@/components/app/money-input"
import { useCatalog } from "@/components/app/operations/catalog-context"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { useAction } from "@/hooks/use-action"
import { minorToInput, parseMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

export interface BudgetRow {
  id: string
  name: string
  icon: string
  color: string
  limit: number | null
  spent: number
  planned: number
  remaining: number | null
  percent: number | null
}

export function BudgetList({ rows, canManage }: { rows: BudgetRow[]; canManage: boolean }) {
  const [editing, setEditing] = useState<BudgetRow | null>(null)
  const limited = rows.filter((r) => r.limit !== null).sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))
  const unlimited = rows.filter((r) => r.limit === null)

  return (
    <div className="grid grid-cols-1 gap-6">
      {limited.length === 0 ? (
        <EmptyState
          icon={Target}
          title="Лимиты не заданы"
          description={
            canManage
              ? "Задайте месячный лимит для категорий, где важно контролировать траты, — например, «Продукты» или «Развлечения». Лимиты не блокируют операции."
              : "Лимиты задают владелец или администратор пространства."
          }
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {limited.map((r) => (
            <BudgetCard key={r.id} row={r} canManage={canManage} onEdit={() => setEditing(r)} />
          ))}
        </ul>
      )}

      {unlimited.length > 0 ? (
        <section>
          <h2 className="mb-2 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Без лимита</h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {unlimited.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <CategoryIcon icon={r.icon} color={r.color} />
                <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                <span className="text-sm text-muted-foreground">
                  <Money value={r.spent} />
                </span>
                {canManage ? (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                    Задать лимит
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <LimitDialog row={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function BudgetCard({ row, canManage, onEdit }: { row: BudgetRow; canManage: boolean; onEdit: () => void }) {
  const { currency } = useCatalog()
  const percent = row.percent ?? 0
  const over = percent > 100
  const warn = !over && percent >= 85
  const plannedPercent = row.limit ? Math.min(100, ((row.spent + row.planned) / row.limit) * 100) : 0
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-3">
        <CategoryIcon icon={row.icon} color={row.color} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.name}</div>
          <div className="text-xs text-muted-foreground">
            лимит <Money value={row.limit!} currency={currency} />
          </div>
        </div>
        {canManage ? (
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Изменить лимит">
            <Pencil />
          </Button>
        ) : null}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="relative h-full">
          {/* Planned spending as a lighter extension of the bar. */}
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary/25" style={{ width: `${plannedPercent}%` }} />
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-destructive" : warn ? "bg-warning" : "bg-primary")}
            style={{ width: `${Math.min(100, percent)}%` }}
          />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          потрачено <Money value={row.spent} currency={currency} className="font-medium text-foreground" /> · {percent}%
        </span>
        <span className={cn("flex items-center gap-1 font-medium", over ? "text-destructive" : warn ? "text-warning" : "text-muted-foreground")}>
          {over ? <AlertTriangle className="size-3.5" /> : warn ? <AlertTriangle className="size-3.5" /> : <CircleCheck className="size-3.5" />}
          {over ? (
            <>
              превышен на <Money value={-row.remaining!} currency={currency} />
            </>
          ) : (
            <>
              осталось <Money value={row.remaining!} currency={currency} />
            </>
          )}
        </span>
      </div>
      {row.planned > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          ещё запланировано <Money value={row.planned} currency={currency} />
        </p>
      ) : null}
    </li>
  )
}

function LimitDialog({ row, onClose }: { row: BudgetRow | null; onClose: () => void }) {
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">{row ? <LimitForm key={row.id} row={row} onClose={onClose} /> : null}</DialogContent>
    </Dialog>
  )
}

function LimitForm({ row, onClose }: { row: BudgetRow; onClose: () => void }) {
  const [value, setValue] = useState(row.limit ? minorToInput(row.limit) : "")
  const { pending, run } = useAction()
  return (
    <form
      className="grid grid-cols-1 gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        const amount = parseMoney(value)
        if (!amount) return
        run(() => setBudgetAction({ categoryId: row.id, amount }), { success: "Лимит сохранён", onSuccess: onClose })
      }}
    >
      <DialogHeader>
        <DialogTitle>Лимит: {row.name}</DialogTitle>
        <DialogDescription>Сумма на месяц. При превышении появится предупреждение, операции не блокируются.</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="limit">Лимит в месяц</FieldLabel>
        <MoneyInput id="limit" autoFocus value={value} onChange={setValue} />
      </Field>
      <DialogFooter>
        {row.limit ? (
          <Button
            type="button"
            variant="destructive"
            className="sm:mr-auto"
            disabled={pending}
            onClick={() => run(() => setBudgetAction({ categoryId: row.id, amount: null }), { success: "Лимит удалён", onSuccess: onClose })}
          >
            Убрать лимит
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" disabled={pending || !parseMoney(value)}>
          Сохранить
        </Button>
      </DialogFooter>
    </form>
  )
}
