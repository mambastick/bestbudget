import "server-only"
import { createHash } from "node:crypto"
import { and, desc, eq, gte, isNotNull, lte, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb, type DbOrTx } from "@/db"
import {
  categories,
  categoryRules,
  financialAccounts,
  households,
  importBatches,
  importProfiles,
  importRows,
  transactions,
  type Transaction,
} from "@/db/schema"
import { compileRule, suggestCategory } from "@/domain/import/categories"
import { fingerprint, isTransferPair, reconcileMultiset } from "@/domain/import/matching"
import { cellText, normalizeRow } from "@/domain/import/normalize"
import { PROFILES, profileMapping } from "@/domain/import/profiles"
import {
  canImportRow,
  decisionSchema,
  MAX_ROWS,
  previewInputSchema,
  PROFILE_VERSION,
  type Candidate,
  type PreviewInput,
  type RowDecision,
  type RowProposal,
} from "@/domain/import/types"
import { addDays, todayIn } from "@/lib/dates"
import { CURRENCY_CODES } from "@/lib/currencies"
import { audit } from "../audit"
import { assertCan, type HouseholdCtx } from "../context"
import { AppError, conflict, notFound } from "../errors"
import { readStatement } from "../import/file"
import {
  confirmTransaction,
  createExportedTransaction,
  createTransaction,
  removeImportedTransaction,
  restoreImportedTransaction,
  updateTransaction,
  type TransactionInput,
} from "./transactions"

import { ensureLoansMaterialized } from "./loans"

type ImportRow = typeof importRows.$inferSelect

async function ownedBatch(db: DbOrTx, ctx: HouseholdCtx, id: string, lock = false) {
  z.uuid().parse(id)
  const query = db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.householdId, ctx.householdId), eq(importBatches.id, id)))
  const [batch] = await (lock ? query.for("update") : query)
  if (!batch) throw notFound("Импорт не найден")
  return batch
}

/** Serializes commits and undo per household, including overlapping files with different hashes. */
async function lockHousehold(db: DbOrTx, ctx: HouseholdCtx) {
  await db.select({ id: households.id }).from(households).where(eq(households.id, ctx.householdId)).for("update")
}

export async function listImports(ctx: HouseholdCtx) {
  assertCan(ctx, "finance.read")
  return getDb()
    .select()
    .from(importBatches)
    .where(eq(importBatches.householdId, ctx.householdId))
    .orderBy(desc(importBatches.createdAt))
    .limit(100)
}

export async function listImportProfiles(ctx: HouseholdCtx) {
  assertCan(ctx, "finance.read")
  return getDb().select().from(importProfiles).where(eq(importProfiles.householdId, ctx.householdId)).orderBy(importProfiles.name)
}

export async function getImport(ctx: HouseholdCtx, id: string) {
  assertCan(ctx, "finance.read")
  const batch = await ownedBatch(getDb(), ctx, id)
  const rows = await getDb()
    .select()
    .from(importRows)
    .where(and(eq(importRows.householdId, ctx.householdId), eq(importRows.batchId, id)))
    .orderBy(importRows.rowIndex)
  return { batch, rows }
}

export async function previewImport(ctx: HouseholdCtx, bytes: Uint8Array, raw: PreviewInput) {
  assertCan(ctx, "finance.write")
  const input = previewInputSchema.parse(raw)
  const statement = await readStatement(bytes, input.file)
  const headers = statement.rows[input.file.headerRow - 1]!.map(cellText)
  if (!PROFILES.some((p) => p.id === input.profile)) {
    const [profile] = await getDb()
      .select()
      .from(importProfiles)
      .where(and(eq(importProfiles.householdId, ctx.householdId), eq(importProfiles.id, z.uuid().parse(input.profile))))
    if (!profile) throw notFound("Профиль не найден")
  } else if (input.profile !== "custom") {
    input.mapping = profileMapping(input.profile, headers)
    const required = ["date", "amount", "currency", "description"] as const
    if (required.some((field) => input.mapping.columns[field] === undefined))
      throw new AppError("Заголовки не соответствуют выбранному профилю. Используйте мастер колонок.")
  }
  const m = input.mapping
  if (
    m.columns.date === undefined ||
    m.columns.description === undefined ||
    (m.amountMode === "separate" ? m.columns.income === undefined || m.columns.expense === undefined : m.columns.amount === undefined) ||
    (m.amountMode === "direction" && m.columns.direction === undefined)
  )
    throw new AppError("Укажите колонки даты, описания и суммы/направления")
  const db = getDb()
  await ensureLoansMaterialized(ctx, todayIn(ctx.timezone))
  const [accounts, cats, rules] = await Promise.all([
    db.select().from(financialAccounts).where(eq(financialAccounts.householdId, ctx.householdId)),
    db.select().from(categories).where(eq(categories.householdId, ctx.householdId)),
    db.select().from(categoryRules).where(eq(categoryRules.householdId, ctx.householdId)),
  ])
  const resolveAccount = (hint: string | null) => {
    const id = hint ? input.accounts[hint] : input.defaultAccountId
    return accounts.find((a) => (id ? a.id === id : hint && (a.name === hint || a.id === hint)) && !a.archivedAt)
  }
  const parsed = statement.rows
    .slice(input.file.headerRow)
    .map((cells, i) => ({ cells, i }))
    .filter(({ cells }) => cells.some((c) => cellText(c).trim()))
    .map(({ cells, i }) => {
      const normalized = normalizeRow(
        cells,
        m,
        input.profile,
        `${statement.sheets[input.file.sheet] ?? "CSV"}: строка ${input.file.headerRow + i + 1}`,
      )
      if (cells.length !== headers.length) normalized.errors.push("Число колонок не совпадает с заголовком")
      const account = resolveAccount(normalized.accountHint)
      if (!account) normalized.errors.push("Сопоставьте счёт: " + (normalized.accountHint ?? "счёт не указан"))
      else if (account.kind === "loan") normalized.errors.push("Выписка по счёту кредита: используйте раздел «Кредиты», чтобы сохранить состав платежа")
      else if (account.currency !== normalized.currency)
        normalized.errors.push(`Валюта строки ${normalized.currency} не совпадает со счётом ${account.currency}`)
      if (normalized.typeHint === "Перевод") {
        const destination = resolveAccount(normalized.toAccountHint)
        if (
          !destination ||
          destination.kind === "loan" ||
          destination.id === account?.id ||
          destination.currency !== normalized.toCurrency ||
          !normalized.toAmount ||
          normalized.toAmount <= 0
        )
          normalized.errors.push("Проверьте счёт и сумму зачисления перевода")
      }
      const category = suggestCategory(normalized, rules, cats)
      if (normalized.errors.length) normalized.confidence = "review"
      return {
        householdId: ctx.householdId,
        rowIndex: i,
        rowLocator: normalized.rowLocator,
        normalized,
        accountId: account?.id ?? null,
        categoryId: category.categoryId,
        proposal: { candidates: [], categorySource: category.source } as RowProposal,
        fingerprint: account && !normalized.errors.length ? fingerprint(account.id, normalized) : null,
        decision: "skip" as ImportRow["decision"],
      }
    })
  if (!parsed.length || parsed.length > MAX_ROWS) throw new AppError("Нужно от 1 до 50 000 непустых строк")
  const turnover = parsed.reduce((sum, r) => sum + BigInt(Math.abs(r.normalized.amountMinorSigned ?? 0)), 0n)
  if (turnover > BigInt(Number.MAX_SAFE_INTEGER))
    throw new AppError("Суммарный оборот файла слишком велик для точного учёта. Разделите файл на меньшие периоды.")
  const dates = parsed.flatMap((r) => (r.normalized.effectiveDate ? [r.normalized.effectiveDate] : [])).sort()
  const warnings: string[] = []
  const hash = createHash("sha256").update(bytes).digest("hex")
  const previous = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(and(eq(importBatches.householdId, ctx.householdId), eq(importBatches.fileHash, hash), eq(importBatches.status, "committed")))
    .limit(1)
  if (previous.length) warnings.push("Этот файл уже импортировали. Проверьте дубли; повтор файла по умолчанию пропускается.")
  if (input.profile.startsWith("tbank"))
    warnings.push("Т-Банк: экспериментальный профиль, актуальный формат банка не подтверждён. Проверьте предпросмотр.")
  warnings.push(
    "Дата учёта — дата проводки, если она есть, иначе дата операции. Начальный остаток счёта должен относиться к началу импортируемого периода.",
  )
  await addCandidates(db, ctx, parsed, input, dates[0], dates.at(-1))
  return db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(importBatches)
      .values({
        householdId: ctx.householdId,
        accountId: input.defaultAccountId ?? null,
        source: input.profile,
        profileVersion: PROFILE_VERSION,
        fileHash: hash,
        periodFrom: dates[0] ?? null,
        periodTo: dates.at(-1) ?? null,
        config: input,
        counters: { rows: parsed.length, created: 0, confirmed: 0, linked: 0, skipped: 0 },
        warnings,
        createdBy: ctx.userId,
      })
      .returning()
    for (let i = 0; i < parsed.length; i += 500)
      await tx.insert(importRows).values(parsed.slice(i, i + 500).map((r) => ({ ...r, batchId: batch!.id })))
    if (input.saveProfileName) {
      await tx.insert(importProfiles).values({
        householdId: ctx.householdId,
        name: input.saveProfileName,
        config: { file: input.file, mapping: input.mapping },
        createdBy: ctx.userId,
      })
      await audit(
        {
          action: "import.profile_create",
          entityType: "import_batch",
          entityId: batch!.id,
          householdId: ctx.householdId,
          actorId: ctx.userId,
        },
        tx,
      )
    }
    await audit(
      {
        action: "import.preview",
        entityType: "import_batch",
        entityId: batch!.id,
        householdId: ctx.householdId,
        actorId: ctx.userId,
        meta: { rows: parsed.length, profile: input.profile },
      },
      tx,
    )
    return { id: batch!.id }
  })
}

type PreviewRow = Pick<ImportRow, "rowIndex" | "normalized" | "accountId" | "categoryId" | "proposal" | "fingerprint" | "decision">

async function priorFingerprints(db: DbOrTx, ctx: HouseholdCtx, excludeBatch?: string) {
  const rows = await db
    .select({
      fingerprint: importRows.fingerprint,
      externalKey: importRows.externalKey,
      transactionId: importRows.transactionId,
      accountId: importRows.accountId,
      id: importRows.id,
    })
    .from(importRows)
    .innerJoin(importBatches, and(eq(importRows.batchId, importBatches.id), eq(importRows.householdId, importBatches.householdId)))
    .where(
      and(
        eq(importRows.householdId, ctx.householdId),
        eq(importBatches.status, "committed"),
        ne(importRows.decision, "skip"),
        excludeBatch ? ne(importRows.batchId, excludeBatch) : undefined,
      ),
    )
  const seen = new Set<string>()
  return rows.filter((r) => {
    const key = `${r.transactionId ?? r.id}:${r.accountId}:${r.fingerprint}`
    if (!r.fingerprint || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function externalKey(source: string, accountId: string | null, externalId: string | null) {
  return accountId && externalId
    ? createHash("sha256")
        .update(JSON.stringify([source, accountId, externalId]))
        .digest("hex")
    : null
}

/** Loan payments are composite: importing either leg separately would duplicate debt or interest. */
function loanPaymentIndex(existing: Transaction[]) {
  const groups = new Map<string, Transaction[]>()
  for (const t of existing) {
    if (!t.loanId || !t.loanPaymentKey || t.status === "skipped") continue
    const group = groups.get(t.loanPaymentKey) ?? []
    group.push(t)
    groups.set(t.loanPaymentKey, group)
  }
  const index = new Map<string, number[]>()
  for (const group of groups.values()) {
    const total = group.reduce((sum, t) => sum + t.amount, 0)
    for (const t of group) {
      const key = `${t.accountId}:${t.date}`
      const values = index.get(key) ?? []
      values.push(t.amount, total)
      index.set(key, values)
    }
  }
  for (const values of index.values()) values.sort((a, b) => a - b)
  return index
}
function matchesLoanPayment(row: Pick<ImportRow, "normalized" | "accountId">, index: Map<string, number[]>, input: PreviewInput) {
  const n = row.normalized
  if (!row.accountId || !n.effectiveDate || (n.amountMinorSigned ?? 0) >= 0) return false
  const amount = Math.abs(n.amountMinorSigned!)
  for (let day = -Math.max(input.plannedDays, 2); day <= Math.max(input.plannedDays, 2); day++) {
    const values = index.get(`${row.accountId}:${addDays(n.effectiveDate, day)}`) ?? []
    let lo = 0, hi = values.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (values[mid]! < amount - input.plannedTolerance) lo = mid + 1
      else hi = mid
    }
    if (values[lo] !== undefined && values[lo]! <= amount + input.plannedTolerance) return true
  }
  return false
}
const loanImportReason = "Совпадает с платежом по кредиту. Строка исключена: подтвердите платёж целиком в разделе «Кредиты», чтобы учесть тело и проценты без дублей."

async function addCandidates(db: DbOrTx, ctx: HouseholdCtx, rows: PreviewRow[], input: PreviewInput, from?: string, to?: string) {
  const prior = await priorFingerprints(db, ctx)
  const priorByFingerprint = new Map<string, typeof prior>()
  const priorByExternalKey = new Map(prior.filter((p) => p.externalKey).map((p) => [p.externalKey!, p]))
  const incomingExternalKeys = new Set<string>()
  const importedSides = new Set(prior.flatMap((p) => (p.transactionId ? [`${p.transactionId}:${p.accountId}`] : [])))
  for (const p of prior) {
    const bucket = priorByFingerprint.get(p.fingerprint!) ?? []
    bucket.push(p)
    priorByFingerprint.set(p.fingerprint!, bucket)
  }
  const consumedFingerprints = new Map<string, number>()
  const existing =
    from && to
      ? await db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.householdId, ctx.householdId),
              gte(transactions.date, addDays(from, -Math.max(input.plannedDays, 2))),
              lte(transactions.date, addDays(to, Math.max(input.plannedDays, 2))),
              ne(transactions.status, "skipped"),
            ),
          )
      : []
  const loanIndex = loanPaymentIndex(existing)
  for (const row of rows) {
    if (matchesLoanPayment(row, loanIndex, input)) {
      row.normalized.errors.push(loanImportReason)
      row.normalized.confidence = "review"
      row.decision = "skip"
    }
  }
  const accounts = await db
    .select({ id: financialAccounts.id, currency: financialAccounts.currency })
    .from(financialAccounts)
    .where(eq(financialAccounts.householdId, ctx.householdId))
  const currencies = new Map(accounts.map((a) => [a.id, a.currency]))
  const existingById = new Map(existing.map((t) => [t.id, t]))
  const manual = new Map<string, Transaction[]>(),
    planned = new Map<string, Transaction[]>()
  const opposite = new Map<string, Map<string, Transaction[]>>()
  const append = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const bucket = map.get(key) ?? []
    bucket.push(value)
    map.set(key, bucket)
  }
  for (const t of existing) {
    if (t.loanId) continue
    if (t.status === "planned") {
      if (t.type !== "transfer") append(planned, `${t.accountId}:${t.type}:${t.date}`, t)
      else if (currencies.get(t.accountId) === currencies.get(t.toAccountId!)) {
        append(planned, `${t.accountId}:expense:${t.date}`, t)
        append(planned, `${t.toAccountId}:income:${t.date}`, t)
      }
      continue
    }
    if (t.status !== "posted") continue
    const sides = [
      { account: t.accountId, signed: t.type === "income" ? t.amount : -t.amount },
      ...(t.type === "transfer" ? [{ account: t.toAccountId!, signed: t.toAmount ?? t.amount }] : []),
    ]
    for (const side of sides) {
      // Imported rows are reconciled by multiplicity; do not offer the same purchase again as a manual match.
      if (!importedSides.has(`${t.id}:${side.account}`)) append(manual, `${side.account}:${side.signed}:${t.date}`, t)
      const key = `${side.signed}:${t.date}`
      const group = opposite.get(key) ?? new Map<string, Transaction[]>()
      append(group, side.account, t)
      opposite.set(key, group)
    }
  }
  for (const bucket of planned.values()) bucket.sort((a, b) => a.amount - b.amount)
  const incoming = new Map<string, Map<string, Map<string, PreviewRow[]>>>()
  for (const row of rows) {
    if (!row.accountId || !row.normalized.effectiveDate || row.normalized.errors.length || row.normalized.status !== "posted") continue
    const key = `${row.normalized.currency}:${row.normalized.amountMinorSigned}`
    const group = incoming.get(key) ?? new Map<string, Map<string, PreviewRow[]>>()
    const dates = group.get(row.accountId) ?? new Map<string, PreviewRow[]>()
    append(dates, row.normalized.effectiveDate, row)
    group.set(row.accountId, dates)
    incoming.set(key, group)
  }
  for (const row of rows) {
    const n = row.normalized,
      candidates = row.proposal.candidates
    if (!row.accountId || !canImportRow(n)) continue
    const count = consumedFingerprints.get(row.fingerprint!) ?? 0
    const key = externalKey(input.profile, row.accountId, n.externalId)
    const duplicate = (key ? priorByExternalKey.get(key) : undefined) ?? priorByFingerprint.get(row.fingerprint!)?.[count]
    const repeatedExternal = key && incomingExternalKeys.has(key)
    if (key) incomingExternalKeys.add(key)
    if (duplicate) {
      consumedFingerprints.set(row.fingerprint!, count + 1)
      candidates.push({
        kind: "duplicate",
        transactionId: duplicate.transactionId ?? undefined,
        label: "Совпадает с ранее импортированной строкой",
      })
    }
    if (repeatedExternal) candidates.push({ kind: "duplicate", label: "Повтор стабильного банковского ID внутри файла" })
    const exportedTarget = input.profile === "bestbudget-export" && n.externalId ? existingById.get(n.externalId) : undefined
    if (exportedTarget && exportedTarget.accountId === row.accountId && exportedTarget.status === n.exportStatus) {
      candidates.push({
        kind: "manual",
        transactionId: exportedTarget.id,
        version: exportedTarget.version,
        label: `ID операции уже есть: ${exportedTarget.date} · ${exportedTarget.title}`,
      })
      row.decision = "skip"
      continue
    }
    if (n.exportStatus === "planned" || n.exportStatus === "skipped") {
      row.decision = candidates.length ? "skip" : "create"
      continue
    }
    for (let day = -2; day <= 2; day++) {
      for (const t of (manual.get(`${row.accountId}:${n.amountMinorSigned}:${addDays(n.effectiveDate!, day)}`) ?? []).slice(0, 4))
        candidates.push({ kind: "manual", transactionId: t.id, version: t.version, label: `Уже есть: ${t.date} · ${t.title}` })
    }
    let planCount = 0
    const amount = Math.abs(n.amountMinorSigned!)
    for (let day = -input.plannedDays; day <= input.plannedDays && planCount < 20; day++) {
      const bucket =
        planned.get(`${row.accountId}:${n.amountMinorSigned! < 0 ? "expense" : "income"}:${addDays(n.effectiveDate!, day)}`) ?? []
      let lo = 0,
        hi = bucket.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (bucket[mid]!.amount < amount - input.plannedTolerance) lo = mid + 1
        else hi = mid
      }
      for (let i = lo; i < bucket.length && bucket[i]!.amount <= amount + input.plannedTolerance && planCount < 20; i++, planCount++) {
        const t = bucket[i]!
        candidates.push({ kind: "planned", transactionId: t.id, version: t.version, transactionType: t.type, label: `Подтвердить плановую: ${t.date} · ${t.title}` })
      }
    }
    let transferCount = 0
    for (const [account, dates] of incoming.get(`${n.currency}:${-n.amountMinorSigned!}`) ?? []) {
      if (account === row.accountId) continue
      for (let day = -2; day <= 2 && transferCount < 20; day++) {
        for (const other of (dates.get(addDays(n.effectiveDate!, day)) ?? []).slice(0, 20 - transferCount)) {
          candidates.push({ kind: "transfer", rowIndex: other.rowIndex, label: `Свой перевод: строка ${other.rowIndex + 1}` })
          transferCount++
        }
      }
      if (transferCount >= 20) break
    }
    let existingTransferCount = 0
    const seenTransfers = new Set<string>()
    for (let day = -2; day <= 2 && existingTransferCount < 20; day++) {
      for (const [account, bucket] of opposite.get(`${-n.amountMinorSigned!}:${addDays(n.effectiveDate!, day)}`) ?? []) {
        if (account === row.accountId || currencies.get(account) !== n.currency) continue
        for (const t of bucket.slice(0, 20 - existingTransferCount)) {
          if (
            seenTransfers.has(t.id) ||
            t.recurringRuleId ||
            (t.type === "transfer" && (n.amountMinorSigned! > 0 ? t.toAccountId !== row.accountId : t.accountId !== row.accountId))
          )
            continue
          candidates.push({
            kind: "transfer",
            transactionId: t.id,
            version: t.version,
            label: `Свой перевод с операцией: ${t.date} · ${t.title}`,
          })
          existingTransferCount++
          seenTransfers.add(t.id)
        }
        if (existingTransferCount >= 20) break
      }
    }
    if (planCount > 1) n.warnings.push("Несколько подходящих плановых операций: выберите одну вручную")
    row.decision =
      candidates.some((c) => c.kind === "duplicate" || c.kind === "manual") || planCount > 1
        ? "skip"
        : planCount === 1
          ? "confirm"
          : "create"
  }
}

export const commitInputSchema = z.object({
  batchId: z.uuid(),
  version: z.number().int().positive(),
  decisions: z.array(decisionSchema).max(MAX_ROWS),
  acknowledgeBalance: z.boolean().default(false),
})

export async function commitImport(ctx: HouseholdCtx, raw: z.input<typeof commitInputSchema>) {
  assertCan(ctx, "finance.write")
  const input = commitInputSchema.parse(raw)
  return getDb().transaction(async (tx) => {
    await lockHousehold(tx, ctx)
    const batch = await ownedBatch(tx, ctx, input.batchId, true)
    if (batch.status === "committed") return batch.counters
    if (batch.status !== "draft" || batch.version !== input.version) throw conflict()
    const rows = await tx
      .select()
      .from(importRows)
      .where(and(eq(importRows.householdId, ctx.householdId), eq(importRows.batchId, batch.id)))
      .orderBy(importRows.rowIndex)
    const loanRows = await tx.select().from(transactions).where(and(
      eq(transactions.householdId, ctx.householdId), isNotNull(transactions.loanId), ne(transactions.status, "skipped"),
      batch.periodFrom ? gte(transactions.date, addDays(batch.periodFrom, -Math.max(batch.config.plannedDays, 2))) : undefined,
      batch.periodTo ? lte(transactions.date, addDays(batch.periodTo, Math.max(batch.config.plannedDays, 2))) : undefined,
    ))
    const loanIndex = loanPaymentIndex(loanRows)
    const decisions = new Map(input.decisions.map((d) => [d.rowId, d]))
    const rowIds = new Set(rows.map((r) => r.id))
    if (decisions.size !== input.decisions.length || input.decisions.some((d) => !rowIds.has(d.rowId)))
      throw new AppError("Некорректные решения строк")
    const selected = rows.map((r) => ({ ...r, choice: decisions.get(r.id) ?? ({ rowId: r.id, decision: r.decision } as RowDecision) }))
    const byRowIndex = new Map(selected.map((r) => [r.rowIndex, r]))
    const plannedGroups = new Map<string, typeof selected>()
    for (const row of selected) {
      if (row.choice.decision !== "confirm") continue
      const candidate = row.proposal.candidates[row.choice.candidateIndex ?? row.proposal.candidates.findIndex((c) => c.kind === "planned")]
      if (!candidate?.transactionId) continue
      const group = plannedGroups.get(candidate.transactionId) ?? []
      group.push(row)
      plannedGroups.set(candidate.transactionId, group)
    }
    const old = await priorFingerprints(tx, ctx)
    const duplicateFlags = reconcileMultiset(
      rows.map((r) => r.fingerprint ?? ""),
      old.map((r) => r.fingerprint!),
    )
    const externalKeys = new Set(old.flatMap((r) => (r.externalKey ? [r.externalKey] : [])))
    const priorExternalKeys = new Set(externalKeys)
    for (const row of selected) {
      const key = externalKey(batch.source, row.accountId, row.normalized.externalId)
      if (!key || row.choice.decision === "skip") continue
      if (externalKeys.has(key) && row.choice.decision !== "link")
        throw new AppError(`${row.rowLocator}: стабильный банковский ID уже импортирован`)
      externalKeys.add(key)
    }
    // A preview may have become stale after another import; never silently accept new duplicates.
    if (
      selected.some(
        (r, i) =>
          duplicateFlags[i] &&
          r.choice.decision !== "skip" &&
          r.choice.decision !== "link" &&
          !(r.choice.allowDuplicate && r.choice.decision === "create" && r.proposal.candidates.some((c) => c.kind === "duplicate")),
      )
    )
      throw new AppError("Найдены ранее импортированные строки. Пропустите дубли или обновите предпросмотр и явно разрешите создание.")
    const reconciliation = reconcileBalances(rows)
    if (reconciliation.some((r) => !r.matches) && !input.acknowledgeBalance)
      throw new AppError("Остатки не сходятся. Проверьте строки и явно подтвердите расхождение.")
    const counters = { rows: rows.length, created: 0, confirmed: 0, linked: 0, skipped: 0 }
    const consumed = new Set<string>(),
      usedTransactions = new Set<string>()
    const accounts = await tx.select().from(financialAccounts).where(eq(financialAccounts.householdId, ctx.householdId))
    const findAccount = (hint: string | null) =>
      accounts.find((a) => hint && (a.id === batch.config.accounts[hint] || a.name === hint || a.id === hint) && !a.archivedAt)
    const persist = async (
      row: ImportRow,
      decision: RowDecision["decision"],
      transaction: Transaction | null,
      effect: NonNullable<ImportRow["effect"]>,
      before?: Transaction,
    ) => {
      const key = externalKey(batch.source, row.accountId, row.normalized.externalId)
      const alreadyOwned = key && priorExternalKeys.has(key)
      await tx
        .update(importRows)
        .set({
          decision,
          transactionId: transaction?.id ?? null,
          transactionVersion: transaction?.version ?? null,
          categoryId: transaction ? transaction.categoryId : row.categoryId,
          effect,
          externalKey: transaction && !alreadyOwned ? key : null,
          beforeTransaction: before ? (JSON.parse(JSON.stringify(before)) as Record<string, unknown>) : null,
        })
        .where(and(eq(importRows.id, row.id), eq(importRows.householdId, ctx.householdId)))
    }
    const getTarget = async (candidate: Candidate) => {
      if (!candidate.transactionId) throw new AppError("Выберите операцию-кандидат")
      const [target] = await tx
        .select()
        .from(transactions)
        .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.id, candidate.transactionId)))
        .for("update")
      if (!target) throw notFound("Сопоставленная операция удалена")
      if (candidate.version !== undefined && target.version !== candidate.version) throw conflict()
      if (usedTransactions.has(target.id)) throw new AppError("Одна операция выбрана для нескольких строк")
      usedTransactions.add(target.id)
      return target
    }
    for (const row of selected) {
      if (consumed.has(row.id)) continue
      const choice = row.choice,
        n = row.normalized
      const candidate =
        row.proposal.candidates[
          choice.candidateIndex ??
            row.proposal.candidates.findIndex((c) =>
              choice.decision === "confirm"
                ? c.kind === "planned"
                : choice.decision === "transfer"
                  ? c.kind === "transfer"
                  : c.kind === "manual" || c.kind === "duplicate",
            )
        ]
      if (choice.decision === "skip") {
        await persist(row, "skip", null, "skipped")
        counters.skipped++
        continue
      }
      if (matchesLoanPayment(row, loanIndex, batch.config)) throw new AppError(`${row.rowLocator}: ${loanImportReason}`)
      if (!canImportRow(n) || !row.accountId || !n.effectiveDate || !n.amountMinorSigned)
        throw new AppError(`${row.rowLocator}: исправьте ошибки или пропустите строку`)
      const account = accounts.find((a) => a.id === row.accountId && !a.archivedAt)
      if (!account || account.currency !== n.currency) throw new AppError("Счёт изменён или недоступен. Создайте предпросмотр заново.")
      let transaction: Transaction,
        effect: NonNullable<ImportRow["effect"]> = "created",
        before: Transaction | undefined
      if (choice.decision === "link") {
        if (!candidate || !["manual", "duplicate"].includes(candidate.kind)) throw new AppError("Выберите совпавшую операцию")
        transaction = await getTarget(candidate)
        if (transaction.status !== (n.exportStatus ?? "posted")) throw conflict()
        effect = "linked"
        counters.linked++
      } else if (choice.decision === "confirm") {
        if (!candidate || candidate.kind !== "planned") throw new AppError("Выберите плановую операцию")
        before = await getTarget(candidate)
        if (before.status !== "planned") throw conflict()
        const group = plannedGroups.get(before.id) ?? [row]
        const counterpart = before.type === "transfer" ? group.find((r) => r.id !== row.id) : undefined
        if (before.type === "transfer" && (group.length > 2 || (counterpart && !isTransferPair(row, counterpart))))
          throw new AppError("Неоднозначные стороны планового перевода. Выберите одну пару или пропустите лишние строки.")
        const debit =
          before.type === "transfer"
            ? group.find((r) => r.accountId === before!.accountId && (r.normalized.amountMinorSigned ?? 0) < 0)
            : undefined
        const actual = debit?.normalized ?? n
        transaction = await confirmTransaction(
          ctx,
          before.id,
          { version: before.version, amount: Math.abs(actual.amountMinorSigned!), date: actual.effectiveDate! },
          tx,
        )
        if (counterpart) {
          await persist(counterpart, "confirm", transaction, "linked")
          consumed.add(counterpart.id)
          counters.linked++
        }
        effect = "confirmed"
        counters.confirmed++
      } else if (choice.decision === "transfer") {
        if (!candidate || candidate.kind !== "transfer") throw new AppError("Выберите вторую сторону перевода")
        if (candidate.rowIndex !== undefined) {
          const other = byRowIndex.get(candidate.rowIndex)
          if (!other || other.choice.decision !== "transfer" || consumed.has(other.id) || !isTransferPair(row, other))
            throw new AppError("Для своего перевода выберите обе встречные строки как перевод")
          const otherCandidate =
            other.proposal.candidates[other.choice.candidateIndex ?? other.proposal.candidates.findIndex((c) => c.kind === "transfer")]
          if (otherCandidate?.rowIndex !== row.rowIndex) throw new AppError("Стороны перевода должны ссылаться друг на друга")
          const debit = n.amountMinorSigned < 0 ? row : other,
            credit = n.amountMinorSigned > 0 ? row : other
          transaction = await createTransaction(
            ctx,
            {
              type: "transfer",
              accountId: debit.accountId!,
              toAccountId: credit.accountId!,
              amount: Math.abs(n.amountMinorSigned),
              date: debit.normalized.effectiveDate!,
              status: "posted",
              title: "Перевод между своими счетами",
              description: debit.normalized.descriptionRaw,
            },
            tx,
          )
          await persist(other, "transfer", transaction, "linked")
          consumed.add(other.id)
          counters.created++
          counters.linked++
        } else {
          before = await getTarget(candidate)
          if (before.status !== "posted") throw conflict()
          if (before.type === "transfer") {
            transaction = before
            effect = "linked"
            counters.linked++
          } else {
            const otherAccount = accounts.find((a) => a.id === before!.accountId)
            if (!otherAccount || otherAccount.currency !== n.currency) throw new AppError("Валюты сторон перевода различаются")
            transaction = await updateTransaction(
              ctx,
              before.id,
              {
                ...before,
                type: "transfer",
                categoryId: null,
                accountId: n.amountMinorSigned < 0 ? row.accountId : before.accountId,
                toAccountId: n.amountMinorSigned < 0 ? before.accountId : row.accountId,
                date: n.amountMinorSigned < 0 ? n.effectiveDate : before.date,
                status: "posted",
                version: before.version,
                title: "Перевод между своими счетами",
              },
              tx,
            )
            effect = "converted"
            counters.linked++
          }
        }
      } else {
        const destination = n.typeHint === "Перевод" ? findAccount(n.toAccountHint) : undefined
        if (n.typeHint === "Перевод" && (!destination || destination.currency !== n.toCurrency))
          throw new AppError("Счёт зачисления или его валюта изменены. Создайте предпросмотр заново.")
        const values: TransactionInput = {
          type: destination ? "transfer" : n.amountMinorSigned < 0 ? "expense" : "income",
          accountId: row.accountId,
          toAccountId: destination?.id,
          toAmount: destination ? n.toAmount : undefined,
          amount: Math.abs(n.amountMinorSigned),
          date: n.effectiveDate,
          status: "posted",
          categoryId: choice.categoryId === undefined ? row.categoryId : choice.categoryId,
          title: n.title ?? n.descriptionRaw.slice(0, 120),
          description: n.descriptionRaw,
        }
        transaction =
          n.exportStatus === "planned" || n.exportStatus === "skipped"
            ? await createExportedTransaction(ctx, values, n.exportStatus, tx)
            : await createTransaction(ctx, values, tx)
        counters.created++
      }
      await persist(row, choice.decision, transaction, effect, effect === "linked" ? undefined : before)
      if (choice.remember && choice.categoryId && n.descriptionNormalized && transaction.type !== "transfer") {
        await saveCategoryRule(
          ctx,
          { categoryId: choice.categoryId, descriptionMode: "substring", descriptionPattern: n.descriptionNormalized, priority: 100 },
          tx,
        )
      }
    }
    await tx
      .update(importBatches)
      .set({ status: "committed", counters, committedAt: new Date(), version: batch.version + 1 })
      .where(eq(importBatches.id, batch.id))
    await audit(
      {
        action: "import.commit",
        entityType: "import_batch",
        entityId: batch.id,
        householdId: ctx.householdId,
        actorId: ctx.userId,
        meta: { ...counters, balanceAcknowledged: input.acknowledgeBalance },
      },
      tx,
    )
    return counters
  })
}

/** Adjacent balances are meaningful only within an explicitly mapped account/currency. */
export function reconcileBalances(rows: Pick<ImportRow, "normalized" | "accountId">[]) {
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    if (!row.accountId) continue
    const key = `${row.accountId}:${row.normalized.currency}`
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const sorted = [...group].sort((a, b) => (a.normalized.effectiveDate ?? "").localeCompare(b.normalized.effectiveDate ?? ""))
    const results: { accountId: string; currency: string; matches: boolean; expected: number; actual: number }[] = []
    let balance: number | null = null
    for (const { normalized: n } of sorted) {
      if (n.status !== "posted" || n.amountMinorSigned === null || n.errors.length) continue
      const expected: number | null = balance === null ? null : balance + n.amountMinorSigned
      if (n.balanceAfterMinor !== null && expected !== null)
        results.push({
          accountId: key.split(":")[0]!,
          currency: n.currency,
          matches: expected === n.balanceAfterMinor,
          expected,
          actual: n.balanceAfterMinor,
        })
      balance = n.balanceAfterMinor ?? expected
    }
    return results
  })
}

export async function undoImport(ctx: HouseholdCtx, id: string) {
  assertCan(ctx, "finance.write")
  return getDb().transaction(async (tx) => {
    await lockHousehold(tx, ctx)
    const batch = await ownedBatch(tx, ctx, id, true)
    if (batch.status === "undone") return
    if (batch.status !== "committed") throw new AppError("Отменить можно только завершённый импорт")
    const rows = await tx
      .select()
      .from(importRows)
      .where(and(eq(importRows.householdId, ctx.householdId), eq(importRows.batchId, id)))
    const affected = rows.filter((r) => r.effect && ["created", "confirmed", "converted"].includes(r.effect))
    const blockers: string[] = []
    for (const row of affected) {
      const [t] = row.transactionId
        ? await tx
            .select()
            .from(transactions)
            .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.id, row.transactionId)))
            .for("update")
        : []
      const [shared] = row.transactionId
        ? await tx
            .select({ id: importRows.id })
            .from(importRows)
            .innerJoin(importBatches, eq(importBatches.id, importRows.batchId))
            .where(
              and(
                eq(importRows.householdId, ctx.householdId),
                eq(importRows.transactionId, row.transactionId),
                ne(importRows.batchId, id),
                eq(importBatches.status, "committed"),
              ),
            )
            .limit(1)
        : []
      if (!t || t.version !== row.transactionVersion || shared)
        blockers.push(`${row.rowLocator}: ${!t ? "операция удалена" : shared ? "связана с другой партией" : "операция изменена"}`)
    }
    if (blockers.length)
      throw new AppError(
        "Импорт не отменён. " + blockers.slice(0, 20).join("; ") + (blockers.length > 20 ? `; ещё ${blockers.length - 20}` : ""),
      )
    // Detach both sides before removing a transfer. Other batches were checked above.
    await tx
      .update(importRows)
      .set({ transactionId: null, externalKey: null })
      .where(and(eq(importRows.householdId, ctx.householdId), eq(importRows.batchId, id)))
    for (const row of affected) {
      if (row.effect === "created") await removeImportedTransaction(ctx, row.transactionId!, row.transactionVersion!, tx)
      else await restoreImportedTransaction(ctx, row.beforeTransaction as unknown as Transaction, row.transactionVersion!, tx)
    }
    await tx
      .update(importBatches)
      .set({ status: "undone", version: batch.version + 1 })
      .where(eq(importBatches.id, id))
    await audit(
      {
        action: "import.undo",
        entityType: "import_batch",
        entityId: id,
        householdId: ctx.householdId,
        actorId: ctx.userId,
        meta: { operations: affected.length },
      },
      tx,
    )
  })
}

export const categoryRuleInput = z
  .object({
    categoryId: z.uuid(),
    descriptionMode: z.enum(["substring", "regex"]).default("substring"),
    descriptionPattern: z.string().trim().max(200).nullable().optional(),
    mcc: z
      .string()
      .regex(/^\d{4}$/)
      .nullable()
      .optional(),
    currency: z.enum(CURRENCY_CODES).nullable().optional(),
    minAmount: z.number().int().safe().nonnegative().nullable().optional(),
    maxAmount: z.number().int().safe().nonnegative().nullable().optional(),
    priority: z.number().int().min(-1000).max(1000).default(0),
  })
  .refine((r) => r.descriptionPattern || r.mcc || r.minAmount != null || r.maxAmount != null, "Укажите хотя бы одно условие")

export async function saveCategoryRule(ctx: HouseholdCtx, raw: z.input<typeof categoryRuleInput>, db: DbOrTx = getDb()) {
  assertCan(ctx, "finance.write")
  const input = categoryRuleInput.parse(raw)
  const [cat] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.householdId, ctx.householdId), eq(categories.id, input.categoryId)))
  if (!cat || cat.archivedAt) throw notFound("Категория недоступна")
  if (input.minAmount != null && input.maxAmount != null && input.minAmount > input.maxAmount) throw new AppError("Неверный диапазон суммы")
  if (input.descriptionMode === "regex") {
    try {
      compileRule(input.descriptionPattern ?? "")
    } catch {
      throw new AppError("Некорректное регулярное выражение RE2 (без обратных ссылок и lookaround)")
    }
  }
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(categoryRules)
    .where(eq(categoryRules.householdId, ctx.householdId))
  if ((count?.n ?? 0) >= 500) throw new AppError("Не более 500 правил на семью")
  const [rule] = await db
    .insert(categoryRules)
    .values({ ...input, householdId: ctx.householdId, createdBy: ctx.userId })
    .returning()
  await audit(
    {
      action: "import.category_rule_create",
      entityType: "category_rule",
      entityId: rule!.id,
      householdId: ctx.householdId,
      actorId: ctx.userId,
    },
    db,
  )
  return rule!.id
}
