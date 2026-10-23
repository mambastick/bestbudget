"use client"

import { useTranslations, useLocale } from "next-intl"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown, Info } from "lucide-react"
import { toast } from "sonner"
import { undoImportAction } from "@/app/actions/import"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { LinkButton } from "@/components/app/link-button"
import { Section } from "@/components/app/settings/section"
import type { importBatches, importRows } from "@/db/schema"
import { canImportRow, PENDING_ROW_MESSAGE, REJECTED_ROW_MESSAGE, type RowDecision } from "@/domain/import/types"
import type { ActionResult } from "@/server/errors"
import { formatMoney } from "@/lib/money"
import { formatDateFull, formatDayShort } from "@/lib/dates"
import { importMessageData, translateImportMessage } from "@/domain/import/messages"
import bankData from "@/domain/import/bank-data.json"
import { cn } from "@/lib/utils"
import { ImportSelect } from "./import-select"
import { ImportStepper } from "./import-stepper"
import { CategoryRuleEditor } from "./category-rule-editor"

type Row = typeof importRows.$inferSelect
type Batch = typeof importBatches.$inferSelect
type Category = { id: string; name: string; kind: string }
type Filter = "all" | "new" | "duplicate" | "transfer" | "planned" | "pending" | "rejected" | "error"

function rowKind(row: Row): Filter {
  const n = row.normalized
  if (!n.errors.length && !n.exportStatus && (n.status === "pending" || n.status === "rejected")) return n.status
  if (!canImportRow(row.normalized)) return "error"
  if (row.proposal.candidates.some((c) => c.kind === "duplicate" || c.kind === "manual")) return "duplicate"
  if (row.proposal.candidates.some((c) => c.kind === "planned")) return "planned"
  if (row.normalized.typeHint === bankData.markers.transfer || row.proposal.candidates.some((c) => c.kind === "transfer")) return "transfer"
  return "new"
}
function defaultChoice(row: Row): RowDecision {
  return {
    rowId: row.id,
    decision: row.decision,
    categoryId: row.categoryId,
    candidateIndex: row.decision === "confirm" ? row.proposal.candidates.findIndex((c) => c.kind === "planned") : undefined,
  }
}
function decisionOptions(row: Row, t: ReturnType<typeof useTranslations>, locale: string) {
  const options = [{ value: "skip:", label: t("actions.skip") }]
  if (!canImportRow(row.normalized)) return options
  options.push({
    value: "create:",
    label: row.normalized.typeHint === bankData.markers.transfer ? t("actions.createExportTransfer") : t("actions.createTransaction"),
  })
  row.proposal.candidates.forEach((c, i) => {
    const label = translateImportMessage(c.label, locale)
    if (c.kind === "planned") options.push({ value: `confirm:${i}`, label })
    if (c.kind === "transfer") options.push({ value: `transfer:${i}`, label })
    if ((c.kind === "manual" || c.kind === "duplicate") && c.transactionId)
      options.push({ value: `link:${i}`, label: t("actions.link", { label }) })
  })
  return options
}
function Amount({ row }: { row: Row }) {
  const t = useTranslations("import")
  const locale = useLocale()
  const n = row.normalized
  let amount = t("preview.invalidAmount")
  if (n.amountMinorSigned !== null) {
    try {
      amount = formatMoney(n.amountMinorSigned, n.currency, { locale, sign: true })
    } catch {
      /* Invalid currencies remain visible as errors. */
    }
  }
  return (
    <span
      className={cn(
        "whitespace-nowrap text-sm font-medium tabular-nums",
        (n.amountMinorSigned ?? 0) > 0 && "text-emerald-700 dark:text-emerald-400",
        (n.amountMinorSigned ?? 0) < 0 && "text-rose-700 dark:text-rose-400",
      )}
    >
      {amount}
    </span>
  )
}

export function ImportPreview({
  batch,
  rows,
  categories,
  accounts,
  reconciliation,
}: {
  batch: Batch
  rows: Row[]
  categories: Category[]
  accounts: { id: string; name: string }[]
  reconciliation: { accountId: string; currency: string; matches: boolean; expected: number; actual: number }[]
}) {
  const t = useTranslations("import")
  const locale = useLocale()
  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: t("filters.all") },
    { value: "new", label: t("filters.new") },
    { value: "duplicate", label: t("filters.duplicate") },
    { value: "transfer", label: t("filters.transfer") },
    { value: "planned", label: t("filters.planned") },
    { value: "pending", label: t("filters.pending") },
    { value: "rejected", label: t("filters.rejected") },
    { value: "error", label: t("filters.error") },
  ]

  const router = useRouter()
  const [changes, setChanges] = useState<Record<string, RowDecision>>({})
  const [filter, setFilter] = useState<Filter>("all")
  const [limit, setLimit] = useState(100)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Row | null>(null)
  const [similar, setSimilar] = useState<{ row: Row; categoryId: string } | null>(null)
  const [bulkCategory, setBulkCategory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const choiceFor = (row: Row) => changes[row.id] ?? defaultChoice(row)
  const update = (row: Row, patch: Partial<RowDecision>) =>
    setChanges((old) => ({ ...old, [row.id]: { ...(old[row.id] ?? defaultChoice(row)), ...patch } }))
  const filtered = useMemo(() => rows.filter((r) => filter === "all" || rowKind(r) === filter), [rows, filter])
  const visible = filtered.slice(0, limit)
  const toggle = (id: string, checked: boolean) =>
    setSelected((old) => {
      const next = new Set(old)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  const setDecision = (row: Row, value: string) => {
    const [decision, index] = value.split(":")
    const candidateIndex = index ? Number(index) : undefined
    update(row, { decision: decision as RowDecision["decision"], candidateIndex, allowDuplicate: false })
    const candidate = candidateIndex === undefined ? undefined : row.proposal.candidates[candidateIndex]
    if (decision === "transfer" && candidate?.rowIndex !== undefined) {
      const other = rows.find((r) => r.rowIndex === candidate.rowIndex)
      const reciprocal = other?.proposal.candidates.findIndex((c) => c.kind === "transfer" && c.rowIndex === row.rowIndex) ?? -1
      if (other && reciprocal >= 0) update(other, { decision: "transfer", candidateIndex: reciprocal })
    }
  }
  const similarRows = (row: Row) =>
    rows.filter(
      (r) =>
        canImportRow(r.normalized) &&
        choiceFor(r).decision === "create" &&
        r.normalized.typeHint !== bankData.markers.transfer &&
        Math.sign(r.normalized.amountMinorSigned ?? 0) === Math.sign(row.normalized.amountMinorSigned ?? 0) &&
        r.normalized.descriptionNormalized.includes(row.normalized.descriptionNormalized),
    )
  const canRemember = (row: Row) => !!row.normalized.descriptionNormalized && row.normalized.descriptionNormalized.length <= 200
  const changeCategory = (row: Row, categoryId: string) => {
    if ((choiceFor(row).categoryId ?? "none") === categoryId) return
    update(row, { categoryId: categoryId === "none" ? null : categoryId, remember: false })
    if (categoryId !== "none" && canRemember(row)) {
      const count = similarRows(row).length
      const category = categories.find((c) => c.id === categoryId)
      toast(t("similar.prompt", { category: category?.name ?? "", count, description: row.normalized.descriptionNormalized }), {
        duration: 10000,
        action: { label: t("actions.apply"), onClick: () => setSimilar({ row, categoryId }) },
      })
    }
  }
  const applySimilar = () => {
    if (!similar) return
    const targets = similarRows(similar.row)
    setChanges((old) => ({
      ...old,
      ...Object.fromEntries(
        targets.map((r) => [r.id, { ...choiceFor(r), categoryId: similar.categoryId, remember: r.id === similar.row.id }]),
      ),
    }))
    setSimilar(null)
    toast.success(t("preview.categoryApplied"))
  }
  const bulk = (decision: "skip" | "create") => {
    setChanges((old) => ({
      ...old,
      ...Object.fromEntries(
        rows
          .filter((r) => selected.has(r.id) && (decision === "skip" || (canImportRow(r.normalized) && !r.proposal.candidates.length)))
          .map((r) => [r.id, { ...choiceFor(r), decision, candidateIndex: undefined, remember: false }]),
      ),
    }))
    setSelected(new Set())
  }
  const totals = new Map<string, { income: bigint; expense: bigint }>()
  const operationKeys = new Set<string>()
  for (const row of rows) {
    const choice = choiceFor(row),
      n = row.normalized
    if (!["create", "confirm", "transfer"].includes(choice.decision) || !canImportRow(n)) continue
    const candidate = row.proposal.candidates[choice.candidateIndex ?? -1]
    operationKeys.add(
      choice.decision === "confirm"
        ? `plan:${candidate?.transactionId}`
        : choice.decision === "transfer" && candidate?.rowIndex !== undefined
          ? `pair:${Math.min(row.rowIndex, candidate.rowIndex)}`
          : choice.decision === "transfer" && candidate?.transactionId
            ? `transfer:${candidate.transactionId}`
            : row.id,
    )
    if (
      choice.decision === "transfer" ||
      candidate?.transactionType === "transfer" ||
      n.typeHint === bankData.markers.transfer ||
      n.amountMinorSigned === null
    )
      continue
    const total = totals.get(n.currency) ?? { income: 0n, expense: 0n }
    if (n.amountMinorSigned > 0) total.income += BigInt(n.amountMinorSigned)
    else total.expense -= BigInt(n.amountMinorSigned)
    totals.set(n.currency, total)
  }
  const display = (n: bigint, currency: string) =>
    n > BigInt(Number.MAX_SAFE_INTEGER) ? t("preview.amountTooLarge") : formatMoney(Number(n), currency, { locale })
  const balanceMismatch = reconciliation.some((r) => !r.matches)
  const missing = rows.filter(
    (r) => choiceFor(r).decision === "create" && r.normalized.typeHint !== bankData.markers.transfer && !choiceFor(r).categoryId,
  ).length
  const commit = async () => {
    setBusy(true)
    setError("")
    try {
      const form = new FormData()
      form.set("mode", "commit")
      form.set(
        "config",
        JSON.stringify({ batchId: batch.id, version: batch.version, decisions: Object.values(changes), acknowledgeBalance: acknowledged }),
      )
      const result = (await (await fetch("/api/import", { method: "POST", body: form })).json()) as ActionResult<unknown>
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    } catch {
      setError(t("preview.noResponse"))
    } finally {
      setBusy(false)
    }
  }
  const undo = async () => {
    setBusy(true)
    setError("")
    try {
      const result = await undoImportAction(batch.id)
      if (!result.ok) setError(result.error)
      else router.refresh()
    } finally {
      setBusy(false)
    }
  }
  const accountName = (row: Row) =>
    accounts.find((a) => a.id === row.accountId)?.name ?? row.normalized.accountHint ?? t("preview.noAccount")
  const status = (row: Row) => {
    const kind = rowKind(row),
      choice = choiceFor(row)
    const candidate = row.proposal.candidates[choice.candidateIndex ?? -1] ?? row.proposal.candidates.find((c) => c.kind === kind)
    if (kind === "pending") return t("status.pending")
    if (kind === "rejected") return t("status.rejected")
    if (kind === "error")
      return row.normalized.errors.some((e) => ["loanPayment", "loanAccount"].includes(importMessageData(e)?.code ?? ""))
        ? t("status.loanExcluded")
        : t("status.error")
    if (choice.decision === "link") return t("status.link")
    if (choice.decision === "skip") return kind === "duplicate" ? t("status.skipDuplicate") : t("status.skipped")
    if (choice.decision === "confirm")
      return t("status.planned", { label: candidate ? translateImportMessage(candidate.label, locale) : t("status.choosePayment") })
    if (choice.decision === "transfer" || row.normalized.typeHint === bankData.markers.transfer) {
      const other = rows.find((r) => r.rowIndex === candidate?.rowIndex)
      return other ? t("status.transferTo", { account: accountName(other) }) : t("status.transfer")
    }
    if (kind === "duplicate") return t("status.createDuplicate")
    if (kind === "transfer") return t("status.possibleTransfer")
    if (kind === "planned") return t("status.possiblePlanned")
    return t("status.new")
  }
  const displayedCategory = (row: Row) => {
    const choice = choiceFor(row)
    const candidate = row.proposal.candidates[choice.candidateIndex ?? -1]
    return choice.decision === "confirm" && candidate && "categoryId" in candidate ? candidate.categoryId : choice.categoryId
  }
  const categoryOptions = (row: Row) => [
    { value: "none", label: t("preview.noCategory") },
    ...categories
      .filter((c) => c.kind === ((row.normalized.amountMinorSigned ?? 0) < 0 ? "expense" : "income"))
      .map((c) => ({ value: c.id, label: c.name })),
  ]
  const categorySelect = (row: Row, compact = false) => (
    <ImportSelect
      compact={compact}
      label={t("row.categoryLabel", { description: row.normalized.descriptionRaw || row.rowLocator })}
      value={displayedCategory(row) ?? "none"}
      onChange={(id) => changeCategory(row, id)}
      options={categoryOptions(row)}
      disabled={choiceFor(row).decision !== "create" || row.normalized.typeHint === bankData.markers.transfer}
    />
  )
  const remember = (row: Row) => {
    const id = choiceFor(row).categoryId
    if (id) setSimilar({ row, categoryId: id })
  }
  const rowMenu = (row: Row) => {
    const kind = rowKind(row)
    if (kind === "pending" || kind === "rejected")
      return (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-auto px-1 py-1"
                aria-label={t("row.decisionLabel", { description: row.normalized.descriptionRaw || row.rowLocator })}
              />
            }
          >
            <Badge variant="secondary" className="text-muted-foreground">
              {status(row)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{translateImportMessage(kind === "pending" ? PENDING_ROW_MESSAGE : REJECTED_ROW_MESSAGE, locale)}</TooltipContent>
        </Tooltip>
      )
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-auto max-w-full justify-start px-1 py-1 text-left"
              aria-label={t("row.decisionLabel", { description: row.normalized.descriptionRaw || row.rowLocator })}
            />
          }
        >
          <Badge
            variant={rowKind(row) === "error" ? "destructive" : "secondary"}
            className={cn(
              "h-auto max-w-full whitespace-normal text-left",
              rowKind(row) === "duplicate" && "bg-amber-500/10 text-amber-800 dark:text-amber-300",
            )}
          >
            {status(row)}
            <ChevronDown className="shrink-0" />
          </Badge>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72 max-w-[calc(100vw-2rem)]">
          {decisionOptions(row, t, locale).map((o) => (
            <DropdownMenuItem key={o.value} onClick={() => setDecision(row, o.value)}>
              {o.value === `${choiceFor(row).decision}:${choiceFor(row).candidateIndex ?? ""}` ? <Check className="size-3" /> : null}
              {o.label}
            </DropdownMenuItem>
          ))}
          {canRemember(row) && choiceFor(row).decision === "create" && choiceFor(row).categoryId ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => remember(row)}>{t("preview.remember")}</DropdownMenuItem>
            </>
          ) : null}
          {choiceFor(row).decision === "create" && rowKind(row) === "duplicate" ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setEditing(row)}>{t("preview.separatePurchase")}</DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }
  const issues = (row: Row) => {
    const kind = rowKind(row)
    const bankNotice = kind === "pending" ? [PENDING_ROW_MESSAGE] : kind === "rejected" ? [REJECTED_ROW_MESSAGE] : []
    return [
      ...new Set([
        ...row.normalized.errors,
        ...row.normalized.warnings,
        ...(row.proposal.categorySource ? [row.proposal.categorySource] : []),
        ...bankNotice,
      ]),
    ].map((message) => translateImportMessage(message, locale))
  }
  const warnings = batch.warnings
    .filter((w) => importMessageData(w)?.code !== "effectiveDate")
    .map((w) => translateImportMessage(w, locale))
  const transferCount = new Set(
    rows
      .filter(
        (r) =>
          r.transactionId &&
          (r.decision === "transfer" ||
            r.normalized.typeHint === bankData.markers.transfer ||
            r.proposal.candidates.some((c) => c.transactionId === r.transactionId && c.transactionType === "transfer")),
      )
      .map((r) => r.transactionId),
  ).size
  if (batch.status !== "draft")
    return (
      <>
        <ImportStepper step={4} />
        <Section title={batch.status === "committed" ? t("actions.done") : t("result.undone")} description={t("result.description")}>
          <div className="mb-5 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:grid-cols-4">
            {[
              [t("result.created"), batch.counters.created],
              [t("result.confirmed"), batch.counters.confirmed],
              [t("result.transfers"), transferCount],
              [t("result.skipped"), batch.counters.skipped],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted/50 p-3">
                <p className="text-2xl font-semibold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          {batch.counters.linked ? (
            <p className="mb-4 text-sm text-muted-foreground">{t("result.linked", { count: batch.counters.linked })}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/transactions">{t("result.openTransactions")}</LinkButton>
            <LinkButton variant="outline" href="/transactions/import">
              {t("result.newImport")}
            </LinkButton>
            {batch.status === "committed" ? (
              <ConfirmDialog
                title={t("undo.title")}
                description={t("undo.description")}
                confirmLabel={t("undo.confirm")}
                trigger={
                  <Button disabled={busy} variant="outline">
                    {t("undo.confirm")}
                  </Button>
                }
                onConfirm={() => void undo()}
              />
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="mt-3 break-words text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </Section>
      </>
    )
  return (
    <>
      <ImportStepper step={3} />
      <Section
        title={t("preview.title")}
        description={t("preview.period", {
          count: rows.length,
          from: batch.periodFrom ? formatDateFull(batch.periodFrom, locale) : t("preview.unknownPeriod"),
          to: batch.periodTo && batch.periodTo !== batch.periodFrom ? formatDateFull(batch.periodTo, locale) : "",
          range: batch.periodTo && batch.periodTo !== batch.periodFrom ? "yes" : "no",
        })}
      >
        <div className="grid min-w-0 grid-cols-1 gap-4">
          {warnings.map((w, i) => (
            <p key={i} className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              {w}
            </p>
          ))}
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-muted/40 p-3">
            <div className="grid gap-2">
              <p className="text-xs text-muted-foreground">{t("preview.toRecord", { count: operationKeys.size })}</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {totals.size ? (
                  [...totals].map(([currency, total]) => (
                    <div key={currency} className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                      <span>
                        {t("fields.income")}
                        <strong className="ml-1 text-emerald-700 dark:text-emerald-400">{display(total.income, currency)}</strong>
                      </span>
                      <span>
                        {t("fields.expense")}
                        <strong className="ml-1">{display(total.expense, currency)}</strong>
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-sm">{t("preview.noTotals")}</span>
                )}
              </div>
            </div>
            <Popover>
              <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("preview.totalsHelp")} />}>
                <Info className="size-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="max-w-[calc(100vw-2rem)] text-xs leading-relaxed">
                <p>{t("preview.totalsHint")}</p>
                <p>{t("preview.dateHint")}</p>
                <p>{reconciliation.length ? t("preview.balancesHint") : t("preview.noBalances")}</p>
              </PopoverContent>
            </Popover>
          </div>
          {reconciliation.length ? (
            <div className="text-sm">
              {balanceMismatch ? (
                <div className="grid gap-2 rounded-lg border border-destructive/30 p-3">
                  {reconciliation
                    .filter((r) => !r.matches)
                    .slice(0, 10)
                    .map((r, i) => (
                      <p key={i} className="text-destructive">
                        {t("preview.balanceDifference", {
                          account: accounts.find((a) => a.id === r.accountId)?.name ?? "",
                          expected: formatMoney(r.expected, r.currency, { locale }),
                          actual: formatMoney(r.actual, r.currency, { locale }),
                        })}
                      </p>
                    ))}
                  <Label className="flex items-start gap-2">
                    <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} />
                    {t("preview.acknowledge")}
                  </Label>
                </div>
              ) : (
                <p className="flex items-center gap-1 text-muted-foreground">
                  <Check className="size-4" /> {t("preview.balancesMatch")}
                </p>
              )}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("preview.filters")}>
            {filters.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={filter === f.value ? "secondary" : "ghost"}
                aria-pressed={filter === f.value}
                onClick={() => {
                  setFilter(f.value)
                  setLimit(100)
                }}
                className={cn("gap-1.5", filter === f.value && "ring-1 ring-border")}
              >
                {f.label}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {f.value === "all" ? rows.length : rows.filter((r) => rowKind(r) === f.value).length}
                </span>
              </Button>
            ))}
          </div>
          {selected.size ? (
            <div
              role="toolbar"
              aria-label={t("preview.bulkActions")}
              className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2"
            >
              <span className="mr-auto text-xs">{t("preview.selected", { count: selected.size })}</span>
              <Button variant="outline" size="sm" onClick={() => setBulkCategory(true)}>
                {t("preview.bulkCategory")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => bulk("skip")}>
                {t("actions.skip")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => bulk("create")}>
                {t("actions.create")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                {t("preview.clearSelection")}
              </Button>
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-xs text-muted-foreground xl:hidden">
            <Checkbox
              aria-label={t("preview.selectVisible")}
              checked={!!visible.length && visible.every((r) => selected.has(r.id))}
              onCheckedChange={(v) =>
                setSelected((old) => {
                  const next = new Set(old)
                  for (const r of visible) {
                    if (v) next.add(r.id)
                    else next.delete(r.id)
                  }
                  return next
                })
              }
            />
            {t("preview.selectShown")}
          </div>
          <div className="min-w-0">
            <div className="hidden grid-cols-[1.5rem_4rem_minmax(0,1fr)_8.5rem_9rem_10rem] items-center gap-2 border-b pb-2 text-xs text-muted-foreground xl:grid">
              <Checkbox
                aria-label={t("preview.selectVisible")}
                checked={!!visible.length && visible.every((r) => selected.has(r.id))}
                onCheckedChange={(v) =>
                  setSelected((old) => {
                    const next = new Set(old)
                    for (const r of visible) {
                      if (v) next.add(r.id)
                      else next.delete(r.id)
                    }
                    return next
                  })
                }
              />
              <span>{t("preview.date")}</span>
              <span>{t("preview.description")}</span>
              <span className="text-right">{t("preview.amount")}</span>
              <span>{t("preview.category")}</span>
              <span>{t("preview.decisionStatus")}</span>
            </div>
            <ul className="divide-y">
              {visible.map((row) => (
                <li
                  key={row.id}
                  data-testid="import-row"
                  className={cn(
                    "grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2 py-3 xl:grid-cols-[1.5rem_4rem_minmax(0,1fr)_8.5rem_9rem_10rem] xl:items-center xl:py-2",
                    selected.has(row.id) && "bg-primary/5",
                  )}
                >
                  <Checkbox
                    className="mt-1 xl:mt-0"
                    aria-label={t("row.selectLabel", { description: row.normalized.descriptionRaw || row.rowLocator })}
                    checked={selected.has(row.id)}
                    onCheckedChange={(v) => toggle(row.id, v === true)}
                  />
                  <span
                    className="hidden text-xs text-muted-foreground xl:block"
                    title={row.normalized.effectiveDate ? formatDateFull(row.normalized.effectiveDate, locale) : undefined}
                  >
                    {row.normalized.effectiveDate ? formatDayShort(row.normalized.effectiveDate, locale) : "—"}
                  </span>
                  <div className="hidden min-w-0 xl:block">
                    <p className="truncate text-sm" title={row.normalized.descriptionRaw}>
                      {row.normalized.descriptionRaw || t("preview.noDescription")}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.normalized.mcc ? `MCC ${row.normalized.mcc} · ` : ""}
                      {accountName(row)}
                    </p>
                  </div>
                  <div className="hidden text-right xl:block">
                    <Amount row={row} />
                  </div>
                  <div className="hidden min-w-0 xl:block">{categorySelect(row, true)}</div>
                  <div className="hidden min-w-0 items-center gap-1 xl:flex">
                    {rowMenu(row)}
                    {issues(row).length ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label={t("row.detailsLabel", { description: row.normalized.descriptionRaw })}
                              className={cn("shrink-0", rowKind(row) === "error" ? "text-destructive" : "text-muted-foreground")}
                            />
                          }
                        >
                          <Info className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <span>{issues(row).join(". ")}</span>
                        </TooltipContent>
                      </Tooltip>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(row)}
                    className="grid min-w-0 gap-1 text-left xl:hidden"
                    aria-label={t("row.editLabel", { description: row.normalized.descriptionRaw || row.rowLocator })}
                  >
                    <span className="flex min-w-0 items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {row.normalized.descriptionRaw || t("preview.noDescription")}
                      </span>
                      <Amount row={row} />
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {row.normalized.effectiveDate ? formatDayShort(row.normalized.effectiveDate, locale) : t("preview.invalidDate")}
                      </span>
                      <span className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5">
                        {categories.find((c) => c.id === displayedCategory(row))?.name ?? t("preview.noCategory")}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 truncate",
                          rowKind(row) === "error" && "text-destructive",
                          rowKind(row) === "duplicate" && "text-amber-700 dark:text-amber-300",
                          (rowKind(row) === "pending" || rowKind(row) === "rejected") && "text-muted-foreground",
                        )}
                      >
                        {status(row)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!filtered.length ? <p className="py-8 text-center text-sm text-muted-foreground">{t("preview.empty")}</p> : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t("preview.showing", { visible: visible.length, total: filtered.length })}</span>
            {visible.length < filtered.length ? (
              <Button variant="outline" size="sm" onClick={() => setLimit(limit + 100)}>
                {t("preview.more")}
              </Button>
            ) : null}
          </div>
          {missing ? <p className="text-sm text-destructive">{t("preview.missingCategory", { count: missing })}</p> : null}
          {error ? (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <CategoryRuleEditor categories={categories} />
            <ConfirmDialog
              title={t("commit.title")}
              description={t("commit.description")}
              confirmLabel={t("commit.confirm")}
              destructive={false}
              trigger={
                <Button className="w-full sm:w-auto" disabled={busy || missing > 0 || (balanceMismatch && !acknowledged)}>
                  {t("commit.transactions", { count: operationKeys.size })}
                </Button>
              }
              onConfirm={() => void commit()}
            />
          </div>
          <LinkButton variant="ghost" href="/transactions/import" className="justify-self-start">
            {t("preview.back")}
          </LinkButton>
        </div>
      </Section>
      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle className="break-words pr-8">{editing?.normalized.descriptionRaw || t("row.title")}</SheetTitle>
            <SheetDescription>
              {editing?.normalized.effectiveDate ? formatDateFull(editing.normalized.effectiveDate, locale) : t("row.unknownDate")}
              {editing ? ` · ${accountName(editing)}` : ""}
            </SheetDescription>
          </SheetHeader>
          {editing ? (
            <div className="grid gap-4 px-4 pb-6">
              <Amount row={editing} />
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t("row.decision")}</p>
                {decisionOptions(editing, t, locale).map((o) => (
                  <Button
                    key={o.value}
                    variant={
                      `${choiceFor(editing).decision}:${choiceFor(editing).candidateIndex ?? ""}` === o.value ? "secondary" : "outline"
                    }
                    className="h-auto justify-start whitespace-normal py-2 text-left"
                    onClick={() => setDecision(editing, o.value)}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
              {categorySelect(editing)}
              {choiceFor(editing).decision === "create" && rowKind(editing) === "duplicate" ? (
                <Label className="flex items-start gap-2">
                  <Checkbox
                    checked={choiceFor(editing).allowDuplicate ?? false}
                    onCheckedChange={(v) => update(editing, { allowDuplicate: v === true })}
                  />
                  {t("row.allowDuplicate")}
                </Label>
              ) : null}
              {canRemember(editing) && choiceFor(editing).decision === "create" && choiceFor(editing).categoryId ? (
                <Button variant="outline" onClick={() => remember(editing)}>
                  {t("preview.remember")}
                </Button>
              ) : null}
              {issues(editing).map((issue, i) => (
                <p
                  key={i}
                  className={cn("break-words text-xs", rowKind(editing) === "error" ? "text-destructive" : "text-muted-foreground")}
                >
                  {issue}
                </p>
              ))}
              {editing.normalized.bankCategory ? (
                <p className="text-xs text-muted-foreground">{t("row.bankCategory", { category: editing.normalized.bankCategory })}</p>
              ) : null}
              <Button onClick={() => setEditing(null)}>{t("actions.done")}</Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
      <Dialog
        open={similar !== null}
        onOpenChange={(open) => {
          if (!open) setSimilar(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("similar.title")}</DialogTitle>
            <DialogDescription>
              {t("similar.description", {
                category: categories.find((c) => c.id === similar?.categoryId)?.name ?? "",
                count: similar ? similarRows(similar.row).length : 0,
                description: similar?.row.normalized.descriptionNormalized ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSimilar(null)}>
              {t("similar.onlyThis")}
            </Button>
            <Button onClick={applySimilar}>{t("similar.apply")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={bulkCategory} onOpenChange={setBulkCategory}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("bulk.title")}</DialogTitle>
            <DialogDescription>{t("bulk.description")}</DialogDescription>
          </DialogHeader>
          <ImportSelect
            label={t("bulk.category")}
            value="none"
            options={[
              { value: "none", label: t("bulk.chooseCategory") },
              ...categories.map((c) => ({
                value: c.id,
                label: `${c.kind === "income" ? t("category.income") : t("fields.expense")} · ${c.name}`,
              })),
            ]}
            onChange={(id) => {
              const category = categories.find((c) => c.id === id)
              if (!category) return
              setChanges((old) => ({
                ...old,
                ...Object.fromEntries(
                  rows
                    .filter(
                      (r) =>
                        selected.has(r.id) &&
                        choiceFor(r).decision === "create" &&
                        r.normalized.typeHint !== bankData.markers.transfer &&
                        category.kind === ((r.normalized.amountMinorSigned ?? 0) < 0 ? "expense" : "income"),
                    )
                    .map((r) => [r.id, { ...choiceFor(r), categoryId: id, remember: false }]),
                ),
              }))
              setBulkCategory(false)
              setSelected(new Set())
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
