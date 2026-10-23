"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { undoImportAction } from "@/app/actions/import"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { LinkButton } from "@/components/app/link-button"
import { Section } from "@/components/app/settings/section"
import type { importBatches, importRows } from "@/db/schema"
import { canImportRow, type RowDecision } from "@/domain/import/types"
import type { ActionResult } from "@/server/errors"
import { formatMoney } from "@/lib/money"
import { plural } from "@/lib/plural"
import { ImportSelect } from "./import-select"
import { CategoryRuleEditor } from "./category-rule-editor"

type Row = typeof importRows.$inferSelect
type Batch = typeof importBatches.$inferSelect
type Filter = "all" | "new" | "duplicate" | "transfer" | "planned" | "error"
const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "Все строки" },
  { value: "new", label: "Новые" },
  { value: "duplicate", label: "Дубли / уже есть" },
  { value: "transfer", label: "Переводы" },
  { value: "planned", label: "Плановые" },
  { value: "error", label: "Ошибки / не проведены" },
]
function matches(row: Row, filter: Filter) {
  const c = row.proposal.candidates
  if (filter === "all") return true
  if (filter === "error") return !canImportRow(row.normalized)
  if (filter === "new") return !c.length && canImportRow(row.normalized)
  return c.some((x) => (filter === "duplicate" ? x.kind === "duplicate" || x.kind === "manual" : x.kind === filter))
}
const defaultChoice = (r: Row): RowDecision => ({ rowId: r.id, decision: r.decision, categoryId: r.categoryId })
function choiceValue(choice: RowDecision) {
  return `${choice.decision}:${choice.candidateIndex ?? ""}`
}
function decisionOptions(row: Row) {
  const options = [{ value: "skip:", label: "Пропустить" }]
  if (!canImportRow(row.normalized)) return options
  options.push({
    value: "create:",
    label: row.normalized.typeHint === "Перевод" ? "Создать перевод из экспорта" : "Создать новую операцию",
  })
  row.proposal.candidates.forEach((c, i) => {
    if (c.kind === "planned") options.push({ value: `confirm:${i}`, label: c.label })
    if (c.kind === "transfer") options.push({ value: `transfer:${i}`, label: c.label })
    if ((c.kind === "manual" || c.kind === "duplicate") && c.transactionId)
      options.push({ value: `link:${i}`, label: `Связать без создания: ${c.label}` })
  })
  return options
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
  categories: { id: string; name: string; kind: string }[]
  accounts: { id: string; name: string }[]
  reconciliation: { accountId: string; currency: string; matches: boolean; expected: number; actual: number }[]
}) {
  const router = useRouter()
  const [changes, setChanges] = useState<Record<string, RowDecision>>({})
  const [filter, setFilter] = useState<Filter>("all")
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const filtered = useMemo(() => rows.filter((r) => matches(r, filter)), [rows, filter])
  const visible = filtered.slice(page * 50, page * 50 + 50)
  const choiceFor = (row: Row) => {
    const choice = changes[row.id] ?? defaultChoice(row)
    if (choice.decision === "confirm" && choice.candidateIndex === undefined)
      return { ...choice, candidateIndex: row.proposal.candidates.findIndex((c) => c.kind === "planned") }
    return choice
  }
  const update = (row: Row, patch: Partial<RowDecision>) => setChanges((old) => ({ ...old, [row.id]: { ...choiceFor(row), ...patch } }))
  const setDecision = (row: Row, value: string) => {
    const [decision, index] = value.split(":")
    update(row, { decision: decision as RowDecision["decision"], candidateIndex: index ? Number(index) : undefined })
  }
  const totals = useMemo(() => {
    const result = new Map<string, { income: bigint; expense: bigint }>()
    for (const row of rows) {
      const n = row.normalized
      if (n.amountMinorSigned === null || n.errors.length || n.status !== "posted") continue
      const t = result.get(n.currency) ?? { income: 0n, expense: 0n }
      if (n.amountMinorSigned > 0) t.income += BigInt(n.amountMinorSigned)
      else t.expense -= BigInt(n.amountMinorSigned)
      result.set(n.currency, t)
    }
    return [...result.entries()]
  }, [rows])
  const display = (n: bigint, currency: string) =>
    n > BigInt(Number.MAX_SAFE_INTEGER) ? "Сумма превышает точность отображения" : formatMoney(Number(n), currency)
  const balanceMismatch = reconciliation.some((r) => !r.matches)
  const missing = rows.filter((r) => {
    const c = choiceFor(r)
    return c.decision === "create" && r.normalized.typeHint !== "Перевод" && !c.categoryId
  }).length
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
      const response = await fetch("/api/import", { method: "POST", body: form })
      const result = (await response.json()) as ActionResult<unknown>
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
  if (batch.status !== "draft")
    return (
      <Section
        title={batch.status === "committed" ? "4. Готово" : "Импорт отменён"}
        description={`Создано операций: ${batch.counters.created} · подтверждено плановых: ${batch.counters.confirmed} · связано: ${batch.counters.linked} · пропущено строк: ${batch.counters.skipped}`}
      >
        <div className="flex flex-wrap gap-2">
          <LinkButton href="/transactions">К операциям</LinkButton>
          <LinkButton variant="outline" href="/transactions/import">
            Новый импорт
          </LinkButton>
          {batch.status === "committed" ? (
            <ConfirmDialog
              title="Отменить импорт?"
              description="Созданные операции удалятся, плановые вернутся к прежним суммам и датам. Изменённые или связанные с другой партией операции заблокируют отмену целиком."
              confirmLabel="Отменить импорт"
              trigger={
                <Button disabled={busy} variant="destructive">
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
    )
  return (
    <>
      <Section
        title="3. Предпросмотр"
        description={`${rows.length} ${plural(rows.length, "строка", "строки", "строк")} · период ${batch.periodFrom ?? "не определён"} — ${batch.periodTo ?? "не определён"}. Проверьте суммы и решения перед записью.`}
      >
        <div className="grid grid-cols-1 gap-4">
          {batch.warnings.map((w, i) => (
            <p key={i} className="break-words text-sm text-amber-700 dark:text-amber-400">
              {w}
            </p>
          ))}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {totals.map(([currency, t]) => (
              <div key={currency} className="rounded-lg bg-muted p-3 text-sm">
                <p>Движения в файле · {currency}</p>
                <p>Приход: {display(t.income, currency)}</p>
                <p>Расход: {display(t.expense, currency)}</p>
                <p className="text-xs text-muted-foreground">Включая дубли и стороны переводов, до выбранных решений</p>
              </div>
            ))}
          </div>
          {reconciliation.length ? (
            <div className="grid gap-1 text-sm">
              <p className="font-medium">Сверка последовательных остатков из файла</p>
              {reconciliation
                .filter((r) => !r.matches)
                .slice(0, 10)
                .map((r, i) => (
                  <p className="break-words text-destructive" key={i}>
                    {accounts.find((a) => a.id === r.accountId)?.name}: ожидается {formatMoney(r.expected, r.currency)}, в файле{" "}
                    {formatMoney(r.actual, r.currency)}
                  </p>
                ))}
              {!balanceMismatch ? (
                <p>Остатки сходятся.</p>
              ) : (
                <Label className="flex items-start gap-2">
                  <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} />Я проверил расхождение остатков и
                  подтверждаю импорт выбранных строк
                </Label>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Для сверки нужно хотя бы два последовательных остатка по счёту. Остатки и контрольные итоги автоматически не выдумываются.
            </p>
          )}
          <ImportSelect
            label="Фильтр строк"
            value={filter}
            onChange={(v) => {
              setFilter(v as Filter)
              setPage(0)
            }}
            options={filters.map((f) => ({ value: f.value, label: `${f.label} (${rows.filter((r) => matches(r, f.value)).length})` }))}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                setChanges((old) => ({ ...old, ...Object.fromEntries(filtered.map((r) => [r.id, { ...choiceFor(r), decision: "skip" }])) }))
              }
            >
              Пропустить отфильтрованные
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                setChanges((old) => ({
                  ...old,
                  ...Object.fromEntries(
                    filtered
                      .filter((r) => canImportRow(r.normalized) && !r.proposal.candidates.some((c) => c.kind === "duplicate"))
                      .map((r) => [r.id, { ...choiceFor(r), decision: "create", candidateIndex: undefined }]),
                  ),
                }))
              }
            >
              Создать отфильтрованные
            </Button>
          </div>
          <ImportSelect
            label="Категория для отфильтрованных новых строк"
            value="none"
            options={[
              { value: "none", label: "Выберите категорию" },
              ...categories.map((c) => ({ value: c.id, label: `${c.kind === "income" ? "Доход" : "Расход"} · ${c.name}` })),
            ]}
            onChange={(id) => {
              const category = categories.find((c) => c.id === id)
              if (!category) return
              setChanges((old) => ({
                ...old,
                ...Object.fromEntries(
                  filtered
                    .filter(
                      (r) =>
                        choiceFor(r).decision === "create" &&
                        category.kind === ((r.normalized.amountMinorSigned ?? 0) < 0 ? "expense" : "income"),
                    )
                    .map((r) => [r.id, { ...choiceFor(r), categoryId: id }]),
                ),
              }))
            }}
          />
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)] gap-4 border-b pb-2 text-xs font-medium text-muted-foreground md:grid">
            <span>Дата · описание · счёт</span>
            <span>Движение</span>
            <span>Решение и категория</span>
          </div>
          <ul className="grid grid-cols-1 divide-y">
            {visible.map((row) => {
              const n = row.normalized,
                choice = choiceFor(row),
                options = decisionOptions(row)
              return (
                <li
                  key={row.id}
                  className="grid min-w-0 grid-cols-1 gap-3 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)]"
                  data-testid="import-row"
                >
                  <div className="grid min-w-0 content-start gap-1">
                    <span className="text-xs text-muted-foreground">
                      {row.rowLocator} · {n.effectiveDate ?? "Ошибка даты"}
                    </span>
                    <p className="break-words text-sm font-medium">{n.descriptionRaw || "Без описания"}</p>
                    <p className="break-words text-xs text-muted-foreground">
                      {accounts.find((a) => a.id === row.accountId)?.name ?? n.accountHint ?? "Счёт не выбран"}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {row.proposal.candidates.some((c) => c.kind === "duplicate" || c.kind === "manual") ? (
                        <Badge variant="secondary">Дубль / уже есть</Badge>
                      ) : null}
                      {row.proposal.candidates.some((c) => c.kind === "transfer") ? (
                        <Badge variant="secondary">Кандидат перевода</Badge>
                      ) : null}
                      {row.proposal.candidates.some((c) => c.kind === "planned") ? <Badge variant="secondary">Плановая</Badge> : null}
                    </div>
                    {[...n.errors, ...n.warnings].map((e, i) => (
                      <p className="break-words text-xs text-destructive" key={i}>
                        {e}
                      </p>
                    ))}
                  </div>
                  <div className="min-w-0 break-words text-sm tabular-nums">
                    {n.amountMinorSigned !== null && !n.errors.some((e) => e.includes("Валюта")) ? (
                      <span>
                        {Object.hasOwn({ RUB: 1 }, n.currency) || /^[A-Z]{3}$/.test(n.currency)
                          ? (() => {
                              try {
                                return formatMoney(n.amountMinorSigned, n.currency, { sign: true })
                              } catch {
                                return `${n.amountMinorSigned} мин. ед. ${n.currency}`
                              }
                            })()
                          : "Ошибка валюты"}
                      </span>
                    ) : (
                      "Сумма требует проверки"
                    )}
                    {n.originalAmountMinorSigned !== null ? (
                      <p className="text-xs text-muted-foreground">
                        Исходная покупка: {n.originalAmountMinorSigned} мин. ед. {n.originalCurrency}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <ImportSelect
                      label={`Решение для строки ${row.rowIndex + 1}`}
                      value={choiceValue(choice)}
                      onChange={(v) => setDecision(row, v)}
                      options={options}
                    />
                    {choice.decision === "create" && row.proposal.candidates.some((c) => c.kind === "duplicate") ? (
                      <Label className="flex items-start gap-2 text-xs">
                        <Checkbox
                          checked={choice.allowDuplicate ?? false}
                          onCheckedChange={(v) => update(row, { allowDuplicate: v === true })}
                        />
                        Это отдельная покупка: создать несмотря на совпадение
                      </Label>
                    ) : null}
                    {choice.decision === "create" && n.typeHint !== "Перевод" ? (
                      <>
                        <ImportSelect
                          label={`Категория строки ${row.rowIndex + 1}`}
                          value={choice.categoryId ?? "none"}
                          onChange={(v) => update(row, { categoryId: v === "none" ? null : v })}
                          options={[
                            { value: "none", label: "Выберите категорию" },
                            ...categories
                              .filter((c) => c.kind === ((n.amountMinorSigned ?? 0) < 0 ? "expense" : "income"))
                              .map((c) => ({ value: c.id, label: c.name })),
                          ]}
                        />
                        <p className="break-words text-xs text-muted-foreground">{row.proposal.categorySource}</p>
                        {n.descriptionNormalized.length <= 200 && n.descriptionNormalized ? (
                          <Label className="flex items-start gap-2 text-xs">
                            <Checkbox checked={choice.remember ?? false} onCheckedChange={(v) => update(row, { remember: v === true })} />
                            Запомнить для похожих (подстрока описания)
                          </Label>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Показаны {filtered.length ? page * 50 + 1 : 0}–{Math.min(page * 50 + 50, filtered.length)} из {filtered.length}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Назад
              </Button>
              <Button variant="outline" disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(page + 1)}>
                Дальше
              </Button>
            </div>
          </div>
          {missing ? <p className="text-sm text-destructive">Выберите категории или пропустите строки: {missing}.</p> : null}
          {error ? (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <CategoryRuleEditor categories={categories} />
          <div className="flex flex-wrap gap-2">
            <ConfirmDialog
              title="Подтвердить импорт?"
              description="Будут записаны выбранные операции. Дубли и пропущенные строки не создают операций. Свои переводы нужно выбрать с обеих сторон."
              confirmLabel="Записать операции"
              destructive={false}
              trigger={<Button disabled={busy || missing > 0 || (balanceMismatch && !acknowledged)}>Подтвердить импорт</Button>}
              onConfirm={() => void commit()}
            />
            <LinkButton variant="outline" href="/transactions/import">
              Вернуться к настройке файла
            </LinkButton>
          </div>
        </div>
      </Section>
    </>
  )
}
