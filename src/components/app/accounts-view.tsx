"use client"

import { useTranslations, useLocale } from "next-intl"

import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Landmark,
  MoreHorizontal,
  Pencil,
  PiggyBank,
  Plus,
  Trash2,
  Users,
  Wallet,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { createAccountAction, deleteAccountAction, setAccountArchivedAction, updateAccountAction } from "@/app/actions/catalog"
import { CurrencySelect } from "@/components/app/currency-select"
import { useCatalog } from "@/components/app/operations/catalog-context"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Money } from "@/components/app/money"
import { MoneyInput } from "@/components/app/money-input"
import { useOperations } from "@/components/app/operations/operations-provider"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ACCOUNT_KIND_LABELS } from "@/domain/defaults"
import { useAction } from "@/hooks/use-action"
import type { Currency } from "@/lib/currencies"
import { formatMoney, minorToInput, parseMoney } from "@/lib/money"

type Kind = keyof typeof ACCOUNT_KIND_LABELS

export interface AccountItem {
  id: string
  name: string
  kind: Kind
  currency: string
  currencyLocked: boolean
  version: number
  creditLimit: number
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
  loan: Landmark,
}

export function AccountsView({ accounts, canManage, currency }: { accounts: AccountItem[]; canManage: boolean; currency: string }) {
  const t = useTranslations("accounts")
  const ops = useOperations()
  const [editing, setEditing] = useState<AccountItem | "new" | null>(null)
  const active = accounts.filter((a) => !a.archived)
  const archived = accounts.filter((a) => a.archived)
  const total = active.filter((a) => a.currency === currency).reduce((s, a) => s + a.balance, 0)
  const debt = active.filter((a) => a.currency === currency && a.balance < 0).reduce((s, a) => s + a.balance, 0)

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("summary.total", { currency })}</CardDescription>
            <CardTitle className="text-2xl font-semibold">
              <Money value={total} currency={currency} tone={total < 0 ? "expense" : "neutral"} />
            </CardTitle>
          </CardHeader>
        </Card>
        {debt < 0 ? (
          <Card size="sm">
            <CardHeader>
              <CardDescription>{t("summary.debt")}</CardDescription>
              <CardTitle className="text-2xl font-semibold">
                <Money value={debt} currency={currency} tone="expense" />
              </CardTitle>
            </CardHeader>
          </Card>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 sm:col-start-3 sm:justify-end">
          {active.length > 1 ? (
            <Button variant="outline" onClick={() => ops.openCreate({ type: "transfer" })}>
              <ArrowLeftRight /> {t("actions.transfer")}
            </Button>
          ) : null}
          {canManage ? (
            <Button onClick={() => setEditing("new")}>
              <Plus /> {t("actions.account")}
            </Button>
          ) : null}
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {active.map((a) => (
          <AccountCard key={a.id} account={a} canManage={canManage} onEdit={() => setEditing(a)} />
        ))}
      </ul>

      {archived.length > 0 ? (
        <section>
          <h2 className="mb-2 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("actions.archived")}</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((a) => (
              <AccountCard key={a.id} account={a} canManage={canManage} onEdit={() => setEditing(a)} />
            ))}
          </ul>
        </section>
      ) : null}

      <div className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("creditHelp.title")}</p>
        <p className="mt-1">
          {t.rich("creditHelp.description", { transfer: (chunks) => <span className="font-medium text-foreground">{chunks}</span> })}
        </p>
      </div>

      <AccountDialog value={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

function AccountCard({ account: a, canManage, onEdit }: { account: AccountItem; canManage: boolean; onEdit: () => void }) {
  const t = useTranslations("accounts")
  const locale = useLocale()
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
          <div className="line-clamp-2 font-medium break-words">
            {a.kind === "loan" ? (
              <Link href="/loans" className="hover:underline">
                {a.name}
              </Link>
            ) : (
              a.name
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {t(ACCOUNT_KIND_LABELS[a.kind])} · {t("card.transactions", { count: a.operations })}
          </div>
        </div>
        {canManage && a.kind !== "loan" ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("actions.menu")} />}>
              <MoreHorizontal />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil /> {t("actions.edit")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  run(() => setAccountArchivedAction(a.id, !a.archived), {
                    success: a.archived ? t("feedback.restored") : t("feedback.archived"),
                  })
                }
              >
                {a.archived ? <ArchiveRestore /> : <Archive />} {a.archived ? t("actions.restore") : t("actions.archive")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> {t("actions.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="mt-4 text-2xl font-semibold">
        <Money value={a.balance} currency={a.currency} tone={a.balance < 0 ? "expense" : "neutral"} />
      </div>
      <div className="text-xs text-muted-foreground">
        {t("card.openingBalance")}
        <Money value={a.openingBalance} currency={a.currency} />
      </div>
      {a.kind === "credit_card" ? (
        <div className="mt-2 text-xs text-muted-foreground">
          {t("card.creditDetails", {
            debt: formatMoney(Math.max(0, -a.balance), a.currency, { locale }),
            available: formatMoney(Math.max(0, a.creditLimit + a.balance), a.currency, { locale }),
            limit: formatMoney(a.creditLimit, a.currency, { locale }),
          })}
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("delete.title", { name: a.name })}
        description={t("delete.description")}
        onConfirm={() => run(() => deleteAccountAction(a.id), { success: t("feedback.deleted") })}
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
  const t = useTranslations("accounts")
  const locale = useLocale()
  const catalog = useCatalog()
  const [currency, setCurrency] = useState<Currency>((account?.currency ?? catalog.currency) as Currency)
  const [name, setName] = useState(account?.name ?? "")
  const [kind, setKind] = useState<Kind>(account?.kind ?? "debit_card")
  const isCredit = kind === "credit_card"
  const [creditLimit, setCreditLimit] = useState(minorToInput(account?.creditLimit ?? 0, currency, locale))
  // Credit card debt is entered as a positive number and stored as a negative balance.
  const [opening, setOpening] = useState(account ? minorToInput(Math.abs(account.openingBalance), account.currency, locale) : "")
  const [negative, setNegative] = useState(account ? account.openingBalance < 0 : false)
  const { pending, run } = useAction()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const amount = opening.trim() === "" ? 0 : parseMoney(opening, currency)
    if (amount === null) return
    const openingBalance = isCredit || negative ? -amount : amount
    const input = {
      name,
      kind,
      openingBalance,
      currency,
      creditLimit: isCredit ? (parseMoney(creditLimit, currency) ?? 0) : 0,
      version: account?.version,
    }
    run<unknown>(() => (account ? updateAccountAction(account.id, input) : createAccountAction(input)), {
      success: account ? t("feedback.saved") : t("feedback.created"),
      onSuccess: onClose,
    })
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <DialogTitle>{account ? t("actions.account") : t("form.new")}</DialogTitle>
        <DialogDescription>{t("form.description")}</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="acc-name">{t("form.name")}</FieldLabel>
        <Input
          id="acc-name"
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("form.namePlaceholder")}
        />
      </Field>
      <Field>
        <FieldLabel>{t("form.kind")}</FieldLabel>
        <Select
          value={kind}
          onValueChange={(v) => v && setKind(v as Kind)}
          items={Object.entries(ACCOUNT_KIND_LABELS)
            .filter(([value]) => value !== "loan")
            .map(([value, label]) => ({ value, label: t(label) }))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACCOUNT_KIND_LABELS)
              .filter(([value]) => value !== "loan")
              .map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {t(label)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="acc-currency">{t("form.currency")}</FieldLabel>
        <CurrencySelect id="acc-currency" value={currency} onChange={setCurrency} disabled={account?.currencyLocked} />
        {account?.currencyLocked ? <p className="text-xs text-muted-foreground">{t("form.currencyLocked")}</p> : null}
      </Field>
      <Field>
        <FieldLabel htmlFor="acc-opening">{isCredit ? t("form.cardDebt") : t("form.openingBalance")}</FieldLabel>
        <MoneyInput currency={currency} id="acc-opening" value={opening} onChange={setOpening} />
        {!isCredit ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={negative} onChange={(e) => setNegative(e.target.checked)} /> {t("form.overdraft")}
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">{t("form.debtHint")}</p>
        )}
      </Field>
      {isCredit ? (
        <Field>
          <FieldLabel htmlFor="acc-credit-limit">{t("form.creditLimit")}</FieldLabel>
          <MoneyInput id="acc-credit-limit" currency={currency} value={creditLimit} onChange={setCreditLimit} />
        </Field>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("actions.cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {t("actions.save")}
        </Button>
      </DialogFooter>
    </form>
  )
}
