"use client"

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
import { canImportRow, type RowDecision } from "@/domain/import/types"
import type { ActionResult } from "@/server/errors"
import { formatMoney } from "@/lib/money"
import { formatDateFull, formatDayShort } from "@/lib/dates"
import { plural } from "@/lib/plural"
import { cn } from "@/lib/utils"
import { ImportSelect } from "./import-select"
import { ImportStepper } from "./import-stepper"
import { CategoryRuleEditor } from "./category-rule-editor"

type Row = typeof importRows.$inferSelect
type Batch = typeof importBatches.$inferSelect
type Category = { id: string; name: string; kind: string }
type Filter = "all" | "new" | "duplicate" | "transfer" | "planned" | "error"
const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "new", label: "Новые" },
  { value: "duplicate", label: "Дубли" },
  { value: "transfer", label: "Переводы" },
  { value: "planned", label: "Плановые" },
  { value: "error", label: "Ошибки" },
]
function rowKind(row: Row): Filter {
  if (!canImportRow(row.normalized)) return "error"
  if (row.proposal.candidates.some((c) => c.kind === "duplicate" || c.kind === "manual")) return "duplicate"
  if (row.proposal.candidates.some((c) => c.kind === "planned")) return "planned"
  if (row.normalized.typeHint === "Перевод" || row.proposal.candidates.some((c) => c.kind === "transfer")) return "transfer"
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
const localizeDates = (text: string) => text.replace(/\d{4}-\d{2}-\d{2}/g, formatDayShort)
function decisionOptions(row: Row) {
  const options = [{ value: "skip:", label: "Пропустить" }]
  if (!canImportRow(row.normalized)) return options
  options.push({
    value: "create:",
    label: row.normalized.typeHint === "Перевод" ? "Создать перевод из экспорта" : "Создать операцию",
  })
  row.proposal.candidates.forEach((c, i) => {
    if (c.kind === "planned") options.push({ value: `confirm:${i}`, label: localizeDates(c.label) })
    if (c.kind === "transfer") options.push({ value: `transfer:${i}`, label: localizeDates(c.label) })
    if ((c.kind === "manual" || c.kind === "duplicate") && c.transactionId)
      options.push({
        value: `link:${i}`,
        label: `Связать: ${localizeDates(c.label)}`,
      })
  })
  return options
}
function Amount({ row }: { row: Row }) {
  const n = row.normalized
  let amount = "Проверьте сумму"
  if (n.amountMinorSigned !== null) {
    try {
      amount = formatMoney(n.amountMinorSigned, n.currency, { sign: true })
    } catch {
      /* Invalid currencies remain visible as errors. */
    }
  }
  return (
    <span
      className={cn(
        "whitespace-nowrap text-sm font-medium tabular-nums",
        (n.amountMinorSigned ?? 0) > 0 && "text-emerald-700 dark:text-emerald-400",
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
  reconciliation: {
    accountId: string
    currency: string
    matches: boolean
    expected: number
    actual: number
  }[]
}) {
  const router = useRouter()
  const [changes, setChanges] = useState<Record<string, RowDecision>>({})
  const [filter, setFilter] = useState<Filter>("all")
  const [limit, setLimit] = useState(100)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Row | null>(null)
  const [similar, setSimilar] = useState<{
    row: Row
    categoryId: string
  } | null>(null)
  const [bulkCategory, setBulkCategory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const choiceFor = (row: Row) => changes[row.id] ?? defaultChoice(row)
  const update = (row: Row, patch: Partial<RowDecision>) =>
    setChanges((old) => ({
      ...old,
      [row.id]: { ...(old[row.id] ?? defaultChoice(row)), ...patch },
    }))
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
    update(row, {
      decision: decision as RowDecision["decision"],
      candidateIndex,
      allowDuplicate: false,
    })
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
        r.normalized.typeHint !== "Перевод" &&
        Math.sign(r.normalized.amountMinorSigned ?? 0) === Math.sign(row.normalized.amountMinorSigned ?? 0) &&
        r.normalized.descriptionNormalized.includes(row.normalized.descriptionNormalized),
    )
  const canRemember = (row: Row) => !!row.normalized.descriptionNormalized && row.normalized.descriptionNormalized.length <= 200
  const changeCategory = (row: Row, categoryId: string) => {
    update(row, {
      categoryId: categoryId === "none" ? null : categoryId,
      remember: false,
    })
    if (categoryId !== "none" && canRemember(row)) {
      const count = similarRows(row).length
      const category = categories.find((c) => c.id === categoryId)
      toast(
        `Применить «${category?.name}» к ${count} ${plural(count, "строке", "строкам", "строкам")} «${row.normalized.descriptionNormalized}» и запомнить?`,
        {
          duration: 10000,
          action: {
            label: "Применить",
            onClick: () => setSimilar({ row, categoryId }),
          },
        },
      )
    }
  }
  const applySimilar = () => {
    if (!similar) return
    const targets = similarRows(similar.row)
    setChanges((old) => ({
      ...old,
      ...Object.fromEntries(
        targets.map((r) => [
          r.id,
          {
            ...choiceFor(r),
            categoryId: similar.categoryId,
            remember: r.id === similar.row.id,
          },
        ]),
      ),
    }))
    setSimilar(null)
    toast.success("Категория применена. Правило сохранится вместе с импортом.")
  }
  const bulk = (decision: "skip" | "create") => {
    setChanges((old) => ({
      ...old,
      ...Object.fromEntries(
        rows
          .filter(
            (r) =>
              selected.has(r.id) &&
              (decision === "skip" ||
                (canImportRow(r.normalized) && !r.proposal.candidates.some((c) => c.kind === "duplicate" || c.kind === "manual"))),
          )
          .map((r) => [
            r.id,
            {
              ...choiceFor(r),
              decision,
              candidateIndex: undefined,
              remember: false,
            },
          ]),
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
    if (choice.decision === "transfer" || n.typeHint === "Перевод" || n.amountMinorSigned === null) continue
    const t = totals.get(n.currency) ?? { income: 0n, expense: 0n }
    if (n.amountMinorSigned > 0) t.income += BigInt(n.amountMinorSigned)
    else t.expense -= BigInt(n.amountMinorSigned)
    totals.set(n.currency, t)
  }
  const display = (n: bigint, currency: string) =>
    n > BigInt(Number.MAX_SAFE_INTEGER) ? "Сумма слишком велика" : formatMoney(Number(n), currency)
  const balanceMismatch = reconciliation.some((r) => !r.matches)
  const missing = rows.filter(
    (r) => choiceFor(r).decision === "create" && r.normalized.typeHint !== "Перевод" && !choiceFor(r).categoryId,
  ).length
  const commit = async () => {
    setBusy(true)
    setError("")
    try {
      const form = new FormData()
      form.set("mode", "commit")
      form.set(
        "config",
        JSON.stringify({
          batchId: batch.id,
          version: batch.version,
          decisions: Object.values(changes),
          acknowledgeBalance: acknowledged,
        }),
      )
      const result = (await (await fetch("/api/import", { method: "POST", body: form })).json()) as ActionResult<unknown>
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    } catch {
      setError("Ответ не получен. Откройте эту партию снова: повторное подтверждение безопасно.")
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
  const accountName = (row: Row) => accounts.find((a) => a.id === row.accountId)?.name ?? row.normalized.accountHint ?? "Счёт не выбран"
  const status = (row: Row) => {
    const kind = rowKind(row),
      choice = choiceFor(row)
    const candidate = row.proposal.candidates[choice.candidateIndex ?? -1] ?? row.proposal.candidates.find((c) => c.kind === kind)
    if (kind === "error") return "Ошибка"
    if (choice.decision === "link") return "Уже есть · связать"
    if (kind === "duplicate") return choice.decision === "create" ? "Дубль · создать" : "Дубль · пропуск"
    if (choice.decision === "skip") return "Пропущена"
    if (kind === "planned")
      return `Плановая · ${localizeDates(candidate?.label ?? "выберите платёж").replace(/^Подтвердить плановую: .*? · /, "")}`
    if (kind === "transfer") {
      const other = rows.find((r) => r.rowIndex === candidate?.rowIndex)
      return other ? `Перевод → ${accountName(other)}` : "Перевод"
    }
    return "Новая"
  }
  const categoryOptions = (row: Row) => [
    { value: "none", label: "Без категории" },
    ...categories
      .filter((c) => c.kind === ((row.normalized.amountMinorSigned ?? 0) < 0 ? "expense" : "income"))
      .map((c) => ({ value: c.id, label: c.name })),
  ]
  const categorySelect = (row: Row, compact = false) => (
    <ImportSelect
      compact={compact}
      label={`Категория: ${row.normalized.descriptionRaw || row.rowLocator}`}
      value={choiceFor(row).categoryId ?? "none"}
      onChange={(id) => changeCategory(row, id)}
      options={categoryOptions(row)}
      disabled={choiceFor(row).decision !== "create" || row.normalized.typeHint === "Перевод"}
    />
  )
  const remember = (row: Row) => {
    const id = choiceFor(row).categoryId
    if (id) setSimilar({ row, categoryId: id })
  }
  const rowMenu = (row: Row) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-auto max-w-full justify-start px-1 py-1 text-left"
            aria-label={`Решение: ${row.normalized.descriptionRaw || row.rowLocator}`}
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
        {decisionOptions(row).map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => setDecision(row, o.value)}>
            {o.value === `${choiceFor(row).decision}:${choiceFor(row).candidateIndex ?? ""}` ? <Check className="size-3" /> : null}
            {o.label}
          </DropdownMenuItem>
        ))}
        {canRemember(row) && choiceFor(row).decision === "create" && choiceFor(row).categoryId ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => remember(row)}>Запомнить для похожих…</DropdownMenuItem>
          </>
        ) : null}
        {choiceFor(row).decision === "create" && rowKind(row) === "duplicate" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setEditing(row)}>Подтвердить отдельную покупку…</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const issues = (row: Row) => [...row.normalized.errors, ...row.normalized.warnings]
  const warnings = batch.warnings.filter((w) => !w.startsWith("Дата учёта"))
  const transferCount = new Set(
    rows.filter((r) => r.transactionId && (r.decision === "transfer" || r.normalized.typeHint === "Перевод")).map((r) => r.transactionId),
  ).size
  if (batch.status !== "draft")
    return (
      <>
        <ImportStepper step={4} />
        <Section title={batch.status === "committed" ? "Готово" : "Импорт отменён"} description="Результат импорта сохранён в истории.">
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Создано", batch.counters.created],
              ["Плановых подтверждено", batch.counters.confirmed],
              ["Переводов", transferCount],
              ["Строк пропущено", batch.counters.skipped],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted/50 p-3">
                <p className="text-2xl font-semibold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          {batch.counters.linked ? (
            <p className="mb-4 text-sm text-muted-foreground">Связано с существующими операциями: {batch.counters.linked}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/transactions">Открыть операции</LinkButton>
            <LinkButton variant="outline" href="/transactions/import">
              Новый импорт
            </LinkButton>
            {batch.status === "committed" ? (
              <ConfirmDialog
                title="Отменить импорт?"
                description="Созданные операции удалятся, плановые вернутся к прежним суммам и датам. Изменённые или связанные с другой партией операции заблокируют отмену целиком."
                confirmLabel="Отменить импорт"
                trigger={
                  <Button disabled={busy} variant="outline">
                    Отменить импорт
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
        title="Проверка операций"
        description={`${rows.length} ${plural(rows.length, "строка", "строки", "строк")} · ${batch.periodFrom ? formatDateFull(batch.periodFrom) : "Период не определён"}${batch.periodTo && batch.periodTo !== batch.periodFrom ? ` — ${formatDateFull(batch.periodTo)}` : ""}`}
      >
        <div className="grid min-w-0 grid-cols-1 gap-4">
          {warnings.map((w, i) => (
            <p key={i} className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
              {w}
            </p>
          ))}
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-muted/40 p-3">
            <div className="grid gap-2">
              <p className="text-xs text-muted-foreground">
                К записи · {operationKeys.size} {plural(operationKeys.size, "операция", "операции", "операций")}
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {totals.size ? (
                  [...totals].map(([currency, t]) => (
                    <div key={currency} className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                      <span>
                        Приход <strong className="ml-1 text-emerald-700 dark:text-emerald-400">{display(t.income, currency)}</strong>
                      </span>
                      <span>
                        Расход <strong className="ml-1">{display(t.expense, currency)}</strong>
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-sm">Нет выбранных доходов и расходов</span>
                )}
              </div>
            </div>
            <Popover>
              <PopoverTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Как считаются итоги и даты" />}>
                <Info className="size-4" />
              </PopoverTrigger>
              <PopoverContent align="end" className="max-w-[calc(100vw-2rem)] text-xs leading-relaxed">
                <p>
                  Итоги включают выбранные новые и подтверждаемые операции. Пропуски, связи с существующими операциями и выбранные переводы
                  не увеличивают приход и расход.
                </p>
                <p>
                  Дата учёта — дата проводки, если она есть, иначе дата операции. Начальный остаток счёта должен относиться к началу
                  периода.
                </p>
                <p>
                  {reconciliation.length
                    ? "Остатки проверяются между последовательными строками файла."
                    : "Для сверки нужно два последовательных остатка по счёту. В этом файле их недостаточно."}
                </p>
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
                        {accounts.find((a) => a.id === r.accountId)?.name}: ожидается {formatMoney(r.expected, r.currency)}, в файле{" "}
                        {formatMoney(r.actual, r.currency)}
                      </p>
                    ))}
                  <Label className="flex items-start gap-2">
                    <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} />Я проверил расхождение остатков
                  </Label>
                </div>
              ) : (
                <p className="flex items-center gap-1 text-muted-foreground">
                  <Check className="size-4" /> Остатки сходятся
                </p>
              )}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1" role="group" aria-label="Фильтр строк">
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
              aria-label="Действия с выбранными строками"
              className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 p-2"
            >
              <span className="mr-auto text-xs">Выбрано: {selected.size}</span>
              <Button variant="outline" size="sm" onClick={() => setBulkCategory(true)}>
                Категория…
              </Button>
              <Button variant="outline" size="sm" onClick={() => bulk("skip")}>
                Пропустить
              </Button>
              <Button variant="outline" size="sm" onClick={() => bulk("create")}>
                Создать
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Снять выбор
              </Button>
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-xs text-muted-foreground lg:hidden">
            <Checkbox
              aria-label="Выбрать показанные строки"
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
            Выбрать показанные
          </div>
          <div className="min-w-0">
            <div className="hidden grid-cols-[1.5rem_4rem_minmax(0,1fr)_8.5rem_9rem_10rem] items-center gap-2 border-b pb-2 text-xs text-muted-foreground lg:grid">
              <Checkbox
                aria-label="Выбрать показанные строки"
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
              <span>Дата</span>
              <span>Описание</span>
              <span className="text-right">Сумма</span>
              <span>Категория</span>
              <span>Статус · решение</span>
            </div>
            <ul className="divide-y">
              {visible.map((row) => (
                <li
                  key={row.id}
                  data-testid="import-row"
                  className={cn(
                    "grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2 py-3 lg:grid-cols-[1.5rem_4rem_minmax(0,1fr)_8.5rem_9rem_10rem] lg:items-center lg:py-2",
                    selected.has(row.id) && "bg-primary/5",
                  )}
                >
                  <Checkbox
                    className="mt-1 lg:mt-0"
                    aria-label={`Выбрать: ${row.normalized.descriptionRaw || row.rowLocator}`}
                    checked={selected.has(row.id)}
                    onCheckedChange={(v) => toggle(row.id, v === true)}
                  />
                  <span
                    className="hidden text-xs text-muted-foreground lg:block"
                    title={row.normalized.effectiveDate ? formatDateFull(row.normalized.effectiveDate) : undefined}
                  >
                    {row.normalized.effectiveDate ? formatDayShort(row.normalized.effectiveDate) : "—"}
                  </span>
                  <div className="hidden min-w-0 lg:block">
                    <p className="truncate text-sm" title={row.normalized.descriptionRaw}>
                      {row.normalized.descriptionRaw || "Без описания"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.normalized.mcc ? `MCC ${row.normalized.mcc} · ` : ""}
                      {accountName(row)}
                    </p>
                  </div>
                  <div className="hidden text-right lg:block">
                    <Amount row={row} />
                  </div>
                  <div className="hidden min-w-0 lg:block">{categorySelect(row, true)}</div>
                  <div className="hidden min-w-0 items-center gap-1 lg:flex">
                    {rowMenu(row)}
                    {issues(row).length ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label={`Подробности: ${row.normalized.descriptionRaw}`}
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
                    className="grid min-w-0 gap-1 text-left lg:hidden"
                    aria-label={`Изменить: ${row.normalized.descriptionRaw || row.rowLocator}`}
                  >
                    <span className="flex min-w-0 items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">{row.normalized.descriptionRaw || "Без описания"}</span>
                      <Amount row={row} />
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{row.normalized.effectiveDate ? formatDayShort(row.normalized.effectiveDate) : "Ошибка даты"}</span>
                      <span className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5">
                        {categories.find((c) => c.id === choiceFor(row).categoryId)?.name ?? "Без категории"}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 truncate",
                          rowKind(row) === "error" && "text-destructive",
                          rowKind(row) === "duplicate" && "text-amber-700 dark:text-amber-300",
                        )}
                      >
                        {status(row)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {!filtered.length ? <p className="py-8 text-center text-sm text-muted-foreground">В этом фильтре строк нет</p> : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Показано {visible.length} из {filtered.length}
            </span>
            {visible.length < filtered.length ? (
              <Button variant="outline" size="sm" onClick={() => setLimit(limit + 100)}>
                Показать ещё 100
              </Button>
            ) : null}
          </div>
          {missing ? (
            <p className="text-sm text-destructive">Без категории: {missing}. Выберите категорию или пропустите эти строки.</p>
          ) : null}
          {error ? (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <CategoryRuleEditor categories={categories} />
            <ConfirmDialog
              title="Импортировать операции?"
              description="Выбранные операции будут записаны. Дубли и пропущенные строки не создают операций."
              confirmLabel="Записать операции"
              destructive={false}
              trigger={
                <Button className="w-full sm:w-auto" disabled={busy || missing > 0 || (balanceMismatch && !acknowledged)}>
                  Импортировать {operationKeys.size} {plural(operationKeys.size, "операцию", "операции", "операций")}
                </Button>
              }
              onConfirm={() => void commit()}
            />
          </div>
          <LinkButton variant="ghost" href="/transactions/import" className="justify-self-start">
            Вернуться к файлу
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
            <SheetTitle className="break-words pr-8">{editing?.normalized.descriptionRaw || "Строка выписки"}</SheetTitle>
            <SheetDescription>
              {editing?.normalized.effectiveDate ? formatDateFull(editing.normalized.effectiveDate) : "Дата не распознана"}
              {editing ? ` · ${accountName(editing)}` : ""}
            </SheetDescription>
          </SheetHeader>
          {editing ? (
            <div className="grid gap-4 px-4 pb-6">
              <Amount row={editing} />
              <div className="grid gap-2">
                <p className="text-sm font-medium">Решение</p>
                {decisionOptions(editing).map((o) => (
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
                  Это отдельная покупка: создать несмотря на совпадение
                </Label>
              ) : null}
              {canRemember(editing) && choiceFor(editing).decision === "create" && choiceFor(editing).categoryId ? (
                <Button variant="outline" onClick={() => remember(editing)}>
                  Запомнить для похожих…
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
                <p className="text-xs text-muted-foreground">Категория банка: {editing.normalized.bankCategory}</p>
              ) : null}
              <Button onClick={() => setEditing(null)}>Готово</Button>
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
            <DialogTitle>Применить к похожим строкам?</DialogTitle>
            <DialogDescription>
              Категория «{categories.find((c) => c.id === similar?.categoryId)?.name}» для {similar ? similarRows(similar.row).length : 0}{" "}
              строк с описанием «{similar?.row.normalized.descriptionNormalized}». Правило для следующих импортов сохранится при
              подтверждении партии.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSimilar(null)}>
              Только эта строка
            </Button>
            <Button onClick={applySimilar}>Применить и запомнить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={bulkCategory} onOpenChange={setBulkCategory}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Категория выбранных строк</DialogTitle>
            <DialogDescription>
              Применится к новым операциям подходящего типа. Дубли, переводы и плановые сохранят свои решения.
            </DialogDescription>
          </DialogHeader>
          <ImportSelect
            label="Общая категория"
            value="none"
            options={[
              { value: "none", label: "Выберите категорию" },
              ...categories.map((c) => ({
                value: c.id,
                label: `${c.kind === "income" ? "Доход" : "Расход"} · ${c.name}`,
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
                        r.normalized.typeHint !== "Перевод" &&
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
