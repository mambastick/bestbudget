"use client"

import { Archive, ArchiveRestore, ArrowLeftRight, Banknote, CreditCard, Landmark, MoreHorizontal, Pencil, PiggyBank, Plus, Trash2, Users, Wallet } from "lucide-react"
import { useState } from "react"
import { createAccountAction, deleteAccountAction, setAccountArchivedAction, updateAccountAction } from "@/app/actions/catalog"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Money } from "@/components/app/money"
import { MoneyInput } from "@/components/app/money-input"
import { useOperations } from "@/components/app/operations/operations-provider"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ACCOUNT_KIND_LABELS } from "@/domain/defaults"
import { useAction } from "@/hooks/use-action"
import { minorToInput, parseMoney } from "@/lib/money"

type Kind = keyof typeof ACCOUNT_KIND_LABELS

export interface AccountItem {
  id: string
  name: string
  kind: Kind
  openingBalance: number
  balance: number
  operations: number
  archived: boolean
}

const ICONS: Record<Kind, typeof Wallet> = {
  cash: Banknote,
  debit_card: Wallet,
  credit_card: CreditCard,
  savings: PiggyBank,
  shared: Users,
  other: Landmark,
}

export function AccountsView({ accounts, canManage, currency }: { accounts: AccountItem[]; canManage: boolean; currency: string }) {
  const ops = useOperations()
  const [editing, setEditing] = useState<AccountItem | "new" | null>(null)
  const active = accounts.filter((a) => !a.archived)
  const archived = accounts.filter((a) => a.archived)
  const total = active.reduce((s, a) => s + a.balance, 0)
  const debt = active.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0)

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Всего на счетах</CardDescription>
            <CardTitle className="text-2xl font-semibold">
              <Money value={total} currency={currency} tone={total < 0 ? "expense" : "neutral"} />
            </CardTitle>
          </CardHeader>
        </Card>
        {debt < 0 ? (
          <Card size="sm">
            <CardHeader>
              <CardDescription>Задолженность (кредитные карты, овердрафт)</CardDescription>
              <CardTitle className="text-2xl font-semibold">
                <Money value={debt} currency={currency} tone="expense" />
              </CardTitle>
            </CardHeader>
          </Card>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
          {active.length > 1 ? (
            <Button variant="outline" onClick={() => ops.openCreate({ type: "transfer" })}>
              <ArrowLeftRight /> Перевод
            </Button>
          ) : null}
          {canManage ? (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Счёт
            </Button>
          ) : null}
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((a) => (
          <AccountCard key={a.id} account={a} canManage={canManage} currency={currency} onEdit={() => setEditing(a)} />
        ))}
      </ul>

      {archived.length > 0 ? (
        <section>
          <h2 className="mb-2 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Архив</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((a) => (
              <AccountCard key={a.id} account={a} canManage={canManage} currency={currency} onEdit={() => setEditing(a)} />
            ))}
          </ul>
        </section>
      ) : null}

      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Как учитывать кредитную карту</p>
        <p className="mt-1">
          Создайте счёт «Кредитная карта» с текущим долгом. Покупки по карте записывайте как расходы с этого счёта — они попадут в расходы один раз.
          Погашение карты оформляйте <span className="font-medium text-foreground">переводом</span> с дебетового счёта: переводы между своими счетами
          не считаются ни доходом, ни расходом, поэтому двойного учёта не будет.
        </p>
      </div>

      <AccountDialog value={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function AccountCard({ account: a, canManage, currency, onEdit }: { account: AccountItem; canManage: boolean; currency: string; onEdit: () => void }) {
  const Icon = ICONS[a.kind]
  const { run } = useAction()
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{a.name}</div>
          <div className="text-xs text-muted-foreground">
            {ACCOUNT_KIND_LABELS[a.kind]} · {a.operations} опер.
          </div>
        </div>
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Действия" />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil /> Изменить
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => run(() => setAccountArchivedAction(a.id, !a.archived), { success: a.archived ? "Счёт восстановлен" : "Счёт в архиве" })}>
                {a.archived ? <ArchiveRestore /> : <Archive />} {a.archived ? "Восстановить" : "В архив"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Удалить
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="mt-4 text-2xl font-semibold">
        <Money value={a.balance} currency={currency} tone={a.balance < 0 ? "expense" : "neutral"} />
      </div>
      <div className="text-xs text-muted-foreground">
        начальный остаток <Money value={a.openingBalance} currency={currency} />
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Удалить счёт «${a.name}»?`}
        description="Удалить можно только счёт без операций. Если по счёту есть история — отправьте его в архив."
        onConfirm={() => run(() => deleteAccountAction(a.id), { success: "Счёт удалён" })}
      />
    </li>
  )
}

function AccountDialog({ value, onClose }: { value: AccountItem | "new" | null; onClose: () => void }) {
  return (
    <Dialog open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {value ? <AccountForm key={value === "new" ? "new" : value.id} account={value === "new" ? null : value} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function AccountForm({ account, onClose }: { account: AccountItem | null; onClose: () => void }) {
  const [name, setName] = useState(account?.name ?? "")
  const [kind, setKind] = useState<Kind>(account?.kind ?? "debit_card")
  const isCredit = kind === "credit_card"
  // Credit card debt is entered as a positive number and stored as a negative balance.
  const [opening, setOpening] = useState(account ? minorToInput(Math.abs(account.openingBalance)) : "")
  const [negative, setNegative] = useState(account ? account.openingBalance < 0 : false)
  const { pending, run } = useAction()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = opening.trim() === "" ? 0 : parseMoney(opening)
    if (amount === null) return
    const openingBalance = isCredit || negative ? -amount : amount
    const input = { name, kind, openingBalance }
    run<unknown>(() => (account ? updateAccountAction(account.id, input) : createAccountAction(input)), {
      success: account ? "Счёт сохранён" : "Счёт создан",
      onSuccess: onClose,
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{account ? "Счёт" : "Новый счёт"}</DialogTitle>
        <DialogDescription>Текущий остаток рассчитывается из начального остатка и подтверждённых операций.</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="acc-name">Название</FieldLabel>
        <Input id="acc-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Карта Сбербанка»" />
      </Field>
      <Field>
        <FieldLabel>Тип</FieldLabel>
        <Select value={kind} onValueChange={(v) => v && setKind(v as Kind)} items={Object.entries(ACCOUNT_KIND_LABELS).map(([value, label]) => ({ value, label }))}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACCOUNT_KIND_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="acc-opening">{isCredit ? "Текущий долг по карте" : "Начальный остаток"}</FieldLabel>
        <MoneyInput id="acc-opening" value={opening} onChange={setOpening} />
        {!isCredit ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} /> Отрицательный остаток (овердрафт)
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">Долг хранится как отрицательный остаток счёта.</p>
        )}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Отмена
        </Button>
        <Button type="submit" disabled={pending}>
          Сохранить
        </Button>
      </DialogFooter>
    </form>
  )
}
