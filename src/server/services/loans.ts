import "server-only"
import { assetTranslator } from "@/i18n/assets"
import { and, asc, eq, gte, isNull, lte, ne, notInArray, or, gt, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb, type DbOrTx } from "@/db"
import { categories, financialAccounts, loanEvents, loans, transactions, users, type Loan, type LoanEvent } from "@/db/schema"
import {
  calculateLoanSchedule,
  loanEditBoundary,
  LoanCalculationError,
  loanSnapshot,
  loanTermsAt,
  termForPayment,
  toLoanEventInput,
  type LoanPayment,
  type LoanScheduleRow,
} from "@/domain/loan"
import { addDays, todayIn } from "@/lib/dates"
import { audit } from "../audit"
import { assertCan, type HouseholdCtx } from "../context"
import { AppError, conflict, notFound } from "../errors"
import { amount, isoDate } from "./transactions"

const rate = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,6})?$/, "validation.loanRatePrecision")
  .refine((s) => Number(s) <= 100, "validation.loanRateRange")
export const loanInput = z
  .object({
    name: z.string().trim().min(1, "validation.titleRequired").max(60),
    lender: z.string().trim().min(1, "validation.lender").max(120),
    kind: z.enum(["mortgage", "consumer", "car", "credit_line", "other"]),
    principal: amount,
    trackingBalance: amount,
    annualRate: rate,
    startDate: isoDate,
    trackingDate: isoDate,
    firstPaymentDate: isoDate,
    termMonths: z.number().int().min(1).max(600).optional(),
    paymentAmount: amount.nullable().optional(),
    paymentDay: z.number().int().min(1).max(31),
    scheduleType: z.enum(["annuity", "differentiated"]),
    interestMethod: z.enum(["monthly", "daily_365", "daily_actual"]),
    paymentAccountId: z.uuid(),
    interestCategoryId: z.uuid().optional(),
  })
  .refine((p) => p.trackingBalance <= p.principal, { message: "validation.loanBalance", path: ["trackingBalance"] })
  .refine((p) => p.startDate <= p.trackingDate, { message: "validation.loanStart", path: ["startDate"] })
  .refine((p) => p.termMonths || (p.scheduleType === "annuity" && p.paymentAmount), {
    message: "validation.loanTerm",
    path: ["termMonths"],
  })
export type LoanInput = z.input<typeof loanInput>

function checkedCalculation<T>(calculate: () => T): T {
  try {
    return calculate()
  } catch (e) {
    if (e instanceof LoanCalculationError) throw new AppError(e.messageKey)
    throw e
  }
}

function schedule(p: Loan, events: LoanEvent[], posted: LoanPayment[]) {
  return checkedCalculation(() => calculateLoanSchedule(p, events.map(toLoanEventInput), posted))
}

/** Adjustments of events still in the future do not move today's balance. */
const adjustmentDate = (e: Pick<LoanEvent, "date" | "endDate" | "type">) => (e.type === "holiday" ? e.endDate! : e.date)

const hasLoanHistory = (data: Pick<Awaited<ReturnType<typeof ledger>>, "rows" | "events">) =>
  data.events.length > 0 || data.rows.some((r) => r.status !== "planned" || r.version > 1)

function ledgerDebt(loan: Loan, data: Pick<Awaited<ReturnType<typeof ledger>>, "rows" | "events">, today: string) {
  return (
    loan.trackingBalance -
    data.rows.filter((r) => r.status === "posted" && r.type === "transfer").reduce((s, r) => s + r.amount, 0) -
    data.events.filter((e) => adjustmentDate(e) <= today).reduce((s, e) => s + (e.balanceDelta ?? 0), 0)
  )
}

async function owned(db: DbOrTx, ctx: Pick<HouseholdCtx, "householdId">, id: string, lock = false) {
  if (!z.uuid().safeParse(id).success) throw notFound("loan.notFound")
  const query = db
    .select()
    .from(loans)
    .where(and(eq(loans.id, id), eq(loans.householdId, ctx.householdId)))
  const [row] = await (lock ? query.for("update") : query)
  if (!row) throw notFound("loan.notFound")
  return row
}

async function ledger(db: DbOrTx, loan: Loan) {
  const [events, rows] = await Promise.all([
    db
      .select()
      .from(loanEvents)
      .where(and(eq(loanEvents.householdId, loan.householdId), eq(loanEvents.loanId, loan.id)))
      .orderBy(asc(loanEvents.date)),
    db
      .select()
      .from(transactions)
      .where(and(eq(transactions.householdId, loan.householdId), eq(transactions.loanId, loan.id)))
      .orderBy(asc(transactions.loanDueDate)),
  ])
  const posted = new Map<string, LoanPayment>()
  for (const r of rows) {
    if (r.status !== "posted" || r.loanPart === "prepayment") continue
    const p = posted.get(r.loanDueDate!) ?? { dueDate: r.loanDueDate!, principal: 0, interest: 0 }
    if (r.loanPart === "principal") p.principal += r.amount
    else p.interest += r.amount
    posted.set(p.dueDate, p)
  }
  return { events, rows, posted: [...posted.values()] }
}

export async function createLoan(ctx: HouseholdCtx, raw: LoanInput) {
  assertCan(ctx, "loans.manage")
  const input = loanInput.parse(raw)
  const termMonths =
    input.termMonths ?? checkedCalculation(() => termForPayment(input.trackingBalance, input.annualRate, input.paymentAmount!))
  checkedCalculation(() => calculateLoanSchedule({ ...input, termMonths }))
  if (input.trackingDate > todayIn(ctx.timezone)) throw new AppError("loan.futureTracking")
  return getDb().transaction(async (tx) => {
    const [paymentAccount] = await tx
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.householdId, ctx.householdId),
          eq(financialAccounts.id, input.paymentAccountId),
          isNull(financialAccounts.archivedAt),
        ),
      )
      .for("update")
    if (!paymentAccount || paymentAccount.kind === "loan") throw new AppError("loan.activePaymentAccount")
    const interestCategoryName = assetTranslator("loans", ctx.locale)("generated.interestCategory")
    let categoryId = input.interestCategoryId
    if (!categoryId) {
      await tx
        .insert(categories)
        .values({
          householdId: ctx.householdId,
          kind: "expense",
          name: interestCategoryName,
          icon: "landmark",
          color: "#dc2626",
          sortOrder: 1000,
        })
        .onConflictDoNothing()
      const [cat] = await tx
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.householdId, ctx.householdId),
            eq(categories.kind, "expense"),
            sql`lower(${categories.name}) = lower(${interestCategoryName})`,
            isNull(categories.archivedAt),
          ),
        )
      categoryId = cat!.id
    }
    const [category] = await tx
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.householdId, ctx.householdId),
          eq(categories.id, categoryId),
          eq(categories.kind, "expense"),
          isNull(categories.archivedAt),
        ),
      )
    if (!category) throw notFound("loan.interestCategoryMissing")
    const [account] = await tx
      .insert(financialAccounts)
      .values({
        householdId: ctx.householdId,
        name: input.name,
        kind: "loan",
        currency: paymentAccount.currency,
        openingBalance: -input.trackingBalance,
        sortOrder: 200,
      })
      .returning()
    const { name: _name, ...values } = input
    const [loan] = await tx
      .insert(loans)
      .values({
        ...values,
        termMonths,
        householdId: ctx.householdId,
        accountId: account!.id,
        interestCategoryId: categoryId,
        createdBy: ctx.userId,
      })
      .returning()
    await materialize(tx, loan!, todayIn(ctx.timezone), undefined, ctx.locale)
    await audit(
      {
        action: "loan.create",
        entityType: "loan",
        entityId: loan!.id,
        householdId: ctx.householdId,
        actorId: ctx.userId,
        meta: { name: input.name, trackingBalance: input.trackingBalance },
      },
      tx,
    )
    return loan!
  })
}

function plannedParts(loan: Loan, row: LoanScheduleRow, locale: string) {
  const base = {
    householdId: loan.householdId,
    loanId: loan.id,
    loanDueDate: row.date,
    loanPaymentKey: `${loan.id}:${row.date}`,
    accountId: loan.paymentAccountId,
    date: row.date,
    status: "planned" as const,
    title: assetTranslator("loans", locale)("generated.payment"),
    createdBy: loan.createdBy,
    updatedBy: loan.createdBy,
  }
  return [
    ...(row.principal > 0
      ? [{ ...base, type: "transfer" as const, loanPart: "principal" as const, amount: row.principal, toAccountId: loan.accountId }]
      : []),
    ...(row.interest > 0
      ? [{ ...base, type: "expense" as const, loanPart: "interest" as const, amount: row.interest, categoryId: loan.interestCategoryId }]
      : []),
  ]
}

async function loanCreatorLocale(db: DbOrTx, loan: Loan) {
  if (!loan.createdBy) return "en"
  const [user] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, loan.createdBy))
  return user?.locale ?? "en"
}

async function materialize(db: DbOrTx, loan: Loan, today: string, onlyDate?: string, requestLocale?: string) {
  if (loan.status !== "active") return
  const data = await ledger(db, loan)
  const locale = requestLocale ?? (await loanCreatorLocale(db, loan))
  const rows = schedule(loan, data.events, data.posted).filter(
    (r) => r.kind === "scheduled" && (onlyDate ? r.date === onlyDate : r.date <= addDays(today, 62)),
  )
  const taken = new Set(data.rows.map((r) => r.loanDueDate))
  for (const row of rows) {
    if (taken.has(row.date)) continue
    const parts = plannedParts(loan, row, locale)
    if (parts.length)
      await db
        .insert(transactions)
        .values(parts)
        .onConflictDoNothing({ target: [transactions.loanId, transactions.loanDueDate, transactions.loanPart] })
  }
}

/** The loan row serializes materialization, payment confirmation and schedule changes. */
export async function ensureLoansMaterialized(ctx: Pick<HouseholdCtx, "householdId" | "locale">, today: string) {
  const ids = await getDb()
    .select({ id: loans.id })
    .from(loans)
    .where(and(eq(loans.householdId, ctx.householdId), eq(loans.status, "active")))
  for (const { id } of ids)
    await getDb().transaction(async (tx) => materialize(tx, await owned(tx, ctx, id, true), today, undefined, ctx.locale))
}

export async function materializeLoanPayment(ctx: HouseholdCtx, id: string, date: string) {
  assertCan(ctx, "finance.write")
  isoDate.parse(date)
  await getDb().transaction(async (tx) => {
    const loan = await owned(tx, ctx, id, true)
    await materialize(tx, loan, todayIn(ctx.timezone), date, ctx.locale)
  })
  const [row] = await getDb()
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, ctx.householdId),
        eq(transactions.loanId, id),
        eq(transactions.loanDueDate, date),
        sql`${transactions.loanPart} <> 'prepayment'`,
      ),
    )
  if (!row) throw notFound("loan.paymentNotFound")
  return row.id
}

export async function getLoan(ctx: HouseholdCtx, id: string) {
  assertCan(ctx, "finance.read")
  const db = getDb()
  const loan = await owned(db, ctx, id)
  const data = await ledger(db, loan)
  const [account] = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.householdId, ctx.householdId), eq(financialAccounts.id, loan.accountId)))
  const today = todayIn(ctx.timezone)
  const debt = ledgerDebt(loan, data, today)
  const planned = schedule(loan, data.events, data.posted)
  const eventInputs = data.events.map(toLoanEventInput)
  const rows = planned.map((r) => {
    const payment = data.rows.find((p) => p.loanDueDate === r.date && p.loanPart !== "prepayment")
    return { ...r, id: payment?.id ?? null, status: r.kind === "scheduled" ? (payment?.status ?? "planned") : "posted" }
  })
  const futureInterest =
    rows.filter((r) => r.kind === "scheduled" && r.status === "planned").reduce((s, r) => s + r.interest, 0) +
    rows.filter((r) => r.kind === "capitalization").reduce((s, r) => s + r.accrued!, 0)
  const paidInterest = data.posted.reduce((s, p) => s + p.interest, 0)
  const next = loan.status === "active" ? (rows.find((r) => r.kind === "scheduled" && r.status === "planned") ?? null) : null
  return {
    loan,
    name: account!.name,
    currency: account!.currency,
    events: data.events,
    posted: data.posted,
    rows,
    debt,
    paidInterest,
    futureInterest,
    next,
    payoffDate: rows.at(-1)?.date ?? null,
    terms: loanTermsAt(loan, eventInputs, today),
    editBoundary: loanEditBoundary(loan.trackingDate, eventInputs, data.posted, today),
    hasHistory: hasLoanHistory(data),
  }
}

export async function listLoans(ctx: HouseholdCtx) {
  assertCan(ctx, "finance.read")
  await ensureLoansMaterialized(ctx, todayIn(ctx.timezone))
  const rows = await getDb()
    .select({ id: loans.id })
    .from(loans)
    .where(eq(loans.householdId, ctx.householdId))
    .orderBy(asc(loans.createdAt))
  return Promise.all(rows.map((r) => getLoan(ctx, r.id)))
}

async function regenerate(db: DbOrTx, loan: Loan, from: string, today: string, locale?: string) {
  // A touched payment is retained as a whole, including its other leg.
  const touched = await db
    .select({ key: transactions.loanPaymentKey })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, loan.householdId),
        eq(transactions.loanId, loan.id),
        or(ne(transactions.status, "planned"), gt(transactions.version, 1)),
      ),
    )
  await db.delete(transactions).where(
    and(
      eq(transactions.householdId, loan.householdId),
      eq(transactions.loanId, loan.id),
      eq(transactions.status, "planned"),
      eq(transactions.version, 1),
      gte(transactions.loanDueDate, from),
      touched.length
        ? notInArray(
            transactions.loanPaymentKey,
            touched.map((r) => r.key!),
          )
        : undefined,
    ),
  )
  await syncCapitalizedInterest(db, loan)
  await materialize(db, loan, today, undefined, locale)
}

/** Capitalized interest depends on the balance a holiday starts from, so it is restated after every recalculation. */
async function syncCapitalizedInterest(db: DbOrTx, loan: Loan) {
  const data = await ledger(db, loan)
  const holidays = data.events.filter((e) => e.type === "holiday" && e.holidayInterest === "capitalize")
  if (!holidays.length) return
  const rows = schedule(loan, data.events, data.posted)
  for (const e of holidays) {
    const delta = 0 - (rows.find((r) => r.kind === "capitalization" && r.date === e.endDate)?.accrued ?? 0)
    if (e.balanceDelta !== delta)
      await db
        .update(loanEvents)
        .set({ balanceDelta: delta })
        .where(and(eq(loanEvents.householdId, loan.householdId), eq(loanEvents.id, e.id)))
  }
}

const noteInput = z.string().trim().max(200, "validation.loanNote").optional()
const termsInput = z.object({
  annualRate: rate,
  nextPaymentDate: isoDate,
  paymentDay: z.number().int().min(1).max(31),
  termMonths: z.number().int().min(1).max(600),
  paymentAmount: amount.nullable().optional(),
  scheduleType: z.enum(["annuity", "differentiated"]),
  interestMethod: z.enum(["monthly", "daily_365", "daily_actual"]),
})
const money = z.number().int().min(0).max(100_000_000_000_000)

export const loanEventInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prepayment"), date: isoDate, amount, mode: z.enum(["reduce_term", "reduce_payment"]) }),
  z.object({ type: z.literal("rate_change"), date: isoDate, annualRate: rate }),
  z.object({ type: z.literal("reconciliation"), date: isoDate, balance: money }),
  termsInput.extend({ type: z.literal("restructuring"), date: isoDate, balance: money.nullable().optional(), note: noteInput }),
  z.object({
    type: z.literal("holiday"),
    date: isoDate,
    endDate: isoDate,
    mode: z.enum(["no_payment", "interest_only"]),
    interest: z.enum(["deferred_spread", "deferred_end", "capitalize", "waived"]).nullable(),
    shift: z.enum(["extend_term", "keep_term"]),
    note: noteInput,
  }),
])
export type LoanEventRequest = z.input<typeof loanEventInput>

/** The stored form of a holiday or new terms; shared by adding and restating an event. */
function eventValues(input: z.output<typeof loanEventInput>) {
  if (input.type !== "holiday") return input
  const { mode, interest, shift, ...rest } = input
  return { ...rest, holidayMode: mode, holidayInterest: interest, holidayShift: shift }
}

export async function addLoanEvent(ctx: HouseholdCtx, id: string, version: number, raw: LoanEventRequest) {
  assertCan(ctx, "loans.manage")
  const input = loanEventInput.parse(raw)
  z.number().int().positive().parse(version)
  const today = todayIn(ctx.timezone)
  return getDb().transaction(async (tx) => {
    const loan = await owned(tx, ctx, id, true)
    if (loan.version !== version) throw conflict()
    if (loan.status !== "active") throw new AppError("loan.closed")
    const data = await ledger(tx, loan)
    const isTerms = input.type === "restructuring"
    const scheduledAhead = input.date > today
    if (
      input.date < loan.trackingDate ||
      (scheduledAhead && (input.type === "prepayment" || input.type === "reconciliation")) ||
      data.events.some((e) => e.date <= today && (isTerms ? e.date > input.date : e.date >= input.date)) ||
      data.rows.some((r) => r.status === "posted" && r.loanPart !== "prepayment" && (r.loanDueDate! > input.date || r.date > input.date)) ||
      (input.type === "holiday" && data.rows.some((r) => r.status === "posted" && r.loanPart !== "prepayment" && r.loanDueDate! >= input.date))
    )
      throw new AppError("loan.eventOrder")
    if (data.events.some((e) => e.date === input.date && (e.type === input.type || (isTerms && e.type === "correction"))))
      throw new AppError("loanCalculation.sameDate")
    if (isTerms && scheduledAhead && input.balance != null) throw new AppError("loan.futureBalance")
    const replacesUnpaid = !scheduledAhead && (input.type === "reconciliation" || isTerms)
    if (replacesUnpaid && data.rows.some((r) => r.status === "planned" && r.version > 1 && r.loanDueDate! <= input.date))
      throw new AppError("loan.unpostedManualPayments")
    if (
      !scheduledAhead &&
      !replacesUnpaid &&
      data.rows.some((r) => r.status === "planned" && r.loanDueDate! <= input.date && !(input.type === "holiday" && r.loanDueDate === input.date))
    )
      throw new AppError("loan.previousPayments")
    const actualDebt = ledgerDebt(loan, data, today)
    if (input.type === "prepayment" && actualDebt <= 0) throw new AppError("loan.principalRepaid")
    // A change in force settles the balance from the ledger; one still ahead replays from the planned balance.
    const settledBalance = isTerms && !scheduledAhead ? (input.balance ?? actualDebt) : null
    const values =
      input.type === "prepayment"
        ? { ...input, amount: Math.min(input.amount, actualDebt) }
        : input.type === "reconciliation"
          ? { ...input, balanceDelta: actualDebt - input.balance }
          : isTerms
            ? { ...input, balance: settledBalance, balanceDelta: settledBalance === null ? null : actualDebt - settledBalance }
            : input
    const before = changeSnapshot(loan, data, input)
    if (input.type === "holiday" || input.type === "restructuring") {
      const candidate = input.type === "holiday" ? input : { ...input, balance: settledBalance }
      checkedCalculation(() => calculateLoanSchedule(loan, [...data.events.map(toLoanEventInput), candidate], data.posted))
    }
    const [event] = await tx
      .insert(loanEvents)
      .values({ ...eventValues(values), loanId: id, householdId: ctx.householdId, createdBy: ctx.userId })
      .returning()
    if (input.type === "prepayment")
      await tx.insert(transactions).values({
        householdId: ctx.householdId,
        loanId: id,
        loanDueDate: input.date,
        loanPart: "prepayment",
        loanPaymentKey: `${id}:extra:${input.date}`,
        type: "transfer",
        status: "posted",
        amount: event!.amount!,
        date: input.date,
        accountId: loan.paymentAccountId,
        toAccountId: loan.accountId,
        title: assetTranslator("loans", ctx.locale)("generated.prepayment"),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
        postedAt: new Date(),
      })
    if (replacesUnpaid) {
      // The new balance supersedes unconfirmed historical slots; skipped rows reserve their keys.
      await tx
        .update(transactions)
        .set({ status: "skipped", version: sql`${transactions.version} + 1`, updatedBy: ctx.userId })
        .where(
          and(
            eq(transactions.householdId, ctx.householdId),
            eq(transactions.loanId, id),
            eq(transactions.status, "planned"),
            lte(transactions.loanDueDate, input.date),
          ),
        )
    }
    const [updated] = await tx
      .update(loans)
      .set({ version: loan.version + 1 })
      .where(and(eq(loans.householdId, ctx.householdId), eq(loans.id, id)))
      .returning()
    await regenerate(tx, updated!, input.date, today, ctx.locale)
    await recordChange(tx, updated!, event!.id, input, before)
    await audit(
      { action: `loan.${input.type}`, entityType: "loan", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: values },
      tx,
    )
    return event!
  })
}

/** The terms before a change of contract, kept with the event; ledger corrections carry none. */
function changeSnapshot(loan: Loan, data: Awaited<ReturnType<typeof ledger>>, input: { type: LoanEvent["type"]; date: string }) {
  if (input.type === "prepayment" || input.type === "reconciliation") return null
  return checkedCalculation(() => loanSnapshot(loan, data.events.map(toLoanEventInput), data.posted, snapshotDate(input)))
}

/** A holiday covers the payment due on its first day, so its record looks from just before that day. */
const snapshotDate = (e: { type: LoanEvent["type"]; date: string }) => (e.type === "holiday" ? addDays(e.date, -1) : e.date)

async function recordChange(
  db: DbOrTx,
  loan: Loan,
  eventId: string,
  event: { type: LoanEvent["type"]; date: string },
  before: ReturnType<typeof changeSnapshot>,
) {
  if (!before) return
  const data = await ledger(db, loan)
  const after = checkedCalculation(() => loanSnapshot(loan, data.events.map(toLoanEventInput), data.posted, snapshotDate(event)))
  await db
    .update(loanEvents)
    .set({ terms: { before, after } })
    .where(and(eq(loanEvents.householdId, loan.householdId), eq(loanEvents.id, eventId)))
}

export const loanUpdateInput = z.object({
  name: z.string().trim().min(1, "validation.titleRequired").max(60),
  lender: z.string().trim().min(1, "validation.lender").max(120),
  kind: z.enum(["mortgage", "consumer", "car", "credit_line", "other"]),
  principal: amount,
  startDate: isoDate,
  paymentAccountId: z.uuid(),
  terms: termsInput.extend({ trackingDate: isoDate.optional(), trackingBalance: amount.optional() }).nullable().optional(),
})
export type LoanUpdate = z.input<typeof loanUpdateInput>

/**
 * Without history, new terms rewrite the loan as if entered correctly from the start. Once a payment or event exists,
 * they apply after the edit boundary as a correction, so confirmed payments and prior terms stay as recorded.
 */
export async function updateLoan(ctx: HouseholdCtx, id: string, version: number, raw: LoanUpdate) {
  assertCan(ctx, "loans.manage")
  const input = loanUpdateInput.parse(raw)
  z.number().int().positive().parse(version)
  const today = todayIn(ctx.timezone)
  return getDb().transaction(async (tx) => {
    const loan = await owned(tx, ctx, id, true)
    if (loan.version !== version) throw conflict()
    if (loan.status !== "active") throw new AppError("loan.closed")
    const data = await ledger(tx, loan)
    const hasHistory = hasLoanHistory(data)
    const trackingDate = input.terms?.trackingDate ?? loan.trackingDate
    const trackingBalance = input.terms?.trackingBalance ?? loan.trackingBalance
    if (hasHistory && (trackingDate !== loan.trackingDate || trackingBalance !== loan.trackingBalance))
      throw new AppError("loan.trackingLocked")
    if (trackingDate > today) throw new AppError("loan.futureTracking")
    if (input.principal < trackingBalance) throw new AppError("loan.principalBelowBalance")
    if (input.startDate > trackingDate) throw new AppError("loan.startAfterTracking")
    const paymentAccountChanged = input.paymentAccountId !== loan.paymentAccountId
    if (paymentAccountChanged) {
      const accounts = await tx
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.householdId, ctx.householdId),
            or(eq(financialAccounts.id, input.paymentAccountId), eq(financialAccounts.id, loan.accountId)),
          ),
        )
      const next = accounts.find((a) => a.id === input.paymentAccountId)
      const liability = accounts.find((a) => a.id === loan.accountId)
      if (!next || next.archivedAt || next.kind === "loan") throw new AppError("loan.activePaymentAccount")
      if (next.currency !== liability!.currency) throw new AppError("loan.paymentAccountCurrency")
    }
    await tx
      .update(financialAccounts)
      .set({ name: input.name, ...(input.terms && !hasHistory ? { openingBalance: -trackingBalance } : {}) })
      .where(and(eq(financialAccounts.householdId, ctx.householdId), eq(financialAccounts.id, loan.accountId)))
    const details = {
      lender: input.lender,
      kind: input.kind,
      principal: input.principal,
      startDate: input.startDate,
      paymentAccountId: input.paymentAccountId,
    }
    const rewritten =
      input.terms && !hasHistory
        ? {
            trackingDate,
            trackingBalance,
            annualRate: input.terms.annualRate,
            firstPaymentDate: input.terms.nextPaymentDate,
            paymentDay: input.terms.paymentDay,
            termMonths: input.terms.termMonths,
            paymentAmount: input.terms.paymentAmount ?? null,
            scheduleType: input.terms.scheduleType,
            interestMethod: input.terms.interestMethod,
          }
        : {}
    const [updated] = await tx
      .update(loans)
      .set({ ...details, ...rewritten, version: loan.version + 1 })
      .where(and(eq(loans.householdId, ctx.householdId), eq(loans.id, id)))
      .returning()
    const boundary = loanEditBoundary(loan.trackingDate, data.events.map(toLoanEventInput), data.posted, today)
    // Every plan needs the new account or the rewritten terms; a correction only replaces what comes after it.
    const earliest = trackingDate < loan.trackingDate ? trackingDate : loan.trackingDate
    const regenerateFrom = paymentAccountChanged || !hasHistory ? earliest : addDays(boundary, 1)
    if (input.terms && hasHistory) {
      if (data.rows.some((r) => r.status === "planned" && r.version > 1 && r.loanDueDate! > boundary))
        throw new AppError("loan.unpostedManualPayments")
      const correction = {
        annualRate: input.terms.annualRate,
        nextPaymentDate: input.terms.nextPaymentDate,
        paymentDay: input.terms.paymentDay,
        termMonths: input.terms.termMonths,
        paymentAmount: input.terms.paymentAmount ?? null,
        scheduleType: input.terms.scheduleType,
        interestMethod: input.terms.interestMethod,
      }
      const onBoundary = data.events.find((e) => e.date === boundary && (e.type === "correction" || e.type === "restructuring"))
      // A second edit from the same point restates that change instead of stacking another one on it.
      const others = onBoundary ? data.events.filter((e) => e.id !== onBoundary.id) : data.events
      const candidate = { ...correction, type: "correction" as const, date: boundary, balance: onBoundary?.balance }
      checkedCalculation(() => calculateLoanSchedule(updated!, [...others.map(toLoanEventInput), candidate], data.posted))
      const before = onBoundary?.terms?.before ?? changeSnapshot(updated!, data, { type: "correction", date: boundary })
      const [event] = onBoundary
        ? await tx
            .update(loanEvents)
            .set(correction)
            .where(and(eq(loanEvents.householdId, ctx.householdId), eq(loanEvents.id, onBoundary.id)))
            .returning()
        : await tx
            .insert(loanEvents)
            .values({ ...correction, type: "correction", date: boundary, loanId: id, householdId: ctx.householdId, createdBy: ctx.userId })
            .returning()
      await regenerate(tx, updated!, regenerateFrom, today, ctx.locale)
      await recordChange(tx, updated!, event!.id, { type: "correction", date: boundary }, before)
    } else if (input.terms || paymentAccountChanged) await regenerate(tx, updated!, regenerateFrom, today, ctx.locale)
    await audit(
      {
        action: "loan.update",
        entityType: "loan",
        entityId: id,
        householdId: ctx.householdId,
        actorId: ctx.userId,
        meta: { name: input.name, ...details, terms: input.terms ?? null },
      },
      tx,
    )
    return updated!
  })
}

/** Reverts the latest change of contract while nothing has been confirmed on top of it. */
export async function cancelLoanEvent(ctx: HouseholdCtx, id: string, version: number, eventId: string) {
  assertCan(ctx, "loans.manage")
  z.number().int().positive().parse(version)
  const today = todayIn(ctx.timezone)
  await getDb().transaction(async (tx) => {
    const loan = await owned(tx, ctx, id, true)
    if (loan.version !== version) throw conflict()
    if (loan.status !== "active") throw new AppError("loan.closed")
    const data = await ledger(tx, loan)
    const event = data.events.find((e) => e.id === eventId)
    if (!event) throw notFound("loan.eventNotFound")
    if (
      event.type === "prepayment" ||
      event.type === "reconciliation" ||
      data.events.some((e) => e.id !== event.id && e.date >= event.date) ||
      data.rows.some((r) => r.status === "posted" && r.loanDueDate! > event.date)
    )
      throw new AppError("loan.eventCancel")
    await tx.delete(loanEvents).where(and(eq(loanEvents.householdId, ctx.householdId), eq(loanEvents.id, eventId)))
    // Slots this change closed come back as planned; earlier ones belong to the event that closed them.
    const previousDate = data.events.filter((e) => e.date < event.date).at(-1)?.date ?? loan.trackingDate
    await tx
      .delete(transactions)
      .where(
        and(
          eq(transactions.householdId, ctx.householdId),
          eq(transactions.loanId, id),
          eq(transactions.status, "skipped"),
          gt(transactions.loanDueDate, previousDate),
          lte(transactions.loanDueDate, event.date),
        ),
      )
    const [updated] = await tx
      .update(loans)
      .set({ version: loan.version + 1 })
      .where(and(eq(loans.householdId, ctx.householdId), eq(loans.id, id)))
      .returning()
    await regenerate(tx, updated!, event.date, today, ctx.locale)
    await audit(
      { action: "loan.event_cancel", entityType: "loan", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: { type: event.type, date: event.date } },
      tx,
    )
  })
}

/** Moves the end of a holiday, including ending one early: payments outside the new period return to the plan. */
export async function updateLoanHolidayEnd(ctx: HouseholdCtx, id: string, version: number, eventId: string, rawEndDate: string) {
  assertCan(ctx, "loans.manage")
  z.number().int().positive().parse(version)
  const endDate = isoDate.parse(rawEndDate)
  const today = todayIn(ctx.timezone)
  await getDb().transaction(async (tx) => {
    const loan = await owned(tx, ctx, id, true)
    if (loan.version !== version) throw conflict()
    if (loan.status !== "active") throw new AppError("loan.closed")
    const data = await ledger(tx, loan)
    const event = data.events.find((e) => e.id === eventId)
    if (!event || event.type !== "holiday") throw notFound("loan.eventNotFound")
    if (event.endDate! < today || endDate < event.date || endDate < today) throw new AppError("loan.holidayEnded")
    const before = event.terms?.before ?? null
    await tx
      .update(loanEvents)
      .set({ endDate })
      .where(and(eq(loanEvents.householdId, ctx.householdId), eq(loanEvents.id, eventId)))
    const [updated] = await tx
      .update(loans)
      .set({ version: loan.version + 1 })
      .where(and(eq(loans.householdId, ctx.householdId), eq(loans.id, id)))
      .returning()
    await regenerate(tx, updated!, addDays(endDate < event.endDate! ? endDate : event.endDate!, 1), today, ctx.locale)
    await recordChange(tx, updated!, eventId, event, before)
    await audit(
      { action: "loan.holiday_update", entityType: "loan", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: { date: event.date, from: event.endDate, to: endDate } },
      tx,
    )
  })
}

export const loanConfirmInput = z.object({
  version: z.number().int().positive(),
  date: isoDate,
  amount,
  allocation: z.enum(["principal", "interest", "manual"]),
  principal: z.number().int().min(0).max(100_000_000_000_000).optional(),
})

export async function confirmLoanPayment(ctx: HouseholdCtx, transactionId: string, raw: z.input<typeof loanConfirmInput>) {
  assertCan(ctx, "finance.write")
  const input = loanConfirmInput.parse(raw)
  const today = todayIn(ctx.timezone)
  if (input.date > today) throw new AppError("loan.futureActualDate")
  const db = getDb()
  const [reference] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.id, z.uuid().parse(transactionId))))
  if (!reference?.loanId || reference.loanPart === "prepayment") throw notFound("loan.paymentNotFound")
  return db.transaction(async (tx) => {
    const loan = await owned(tx, ctx, reference.loanId!, true)
    if (loan.status !== "active") throw new AppError("loan.closed")
    const data = await ledger(tx, loan)
    const parts = data.rows.filter((r) => r.loanPaymentKey === reference.loanPaymentKey)
    const ref = parts.find((r) => r.id === transactionId)
    if (!ref || ref.version !== input.version) throw conflict()
    if (parts.some((r) => r.status !== "planned")) throw new AppError("loan.paymentResolved")
    if (data.rows.some((r) => r.status === "planned" && r.loanPart !== "prepayment" && r.loanDueDate! < ref.loanDueDate!))
      throw new AppError("loan.previousPayment")
    if (
      input.date < loan.trackingDate ||
      data.events.some((e) => e.date > input.date && e.date <= today && e.date <= ref.loanDueDate!) ||
      data.rows.some((r) => r.status === "posted" && r.date > input.date)
    )
      throw new AppError("loan.actualDateOrder")
    const plannedPrincipal = parts.find((r) => r.loanPart === "principal")?.amount ?? 0
    const plannedInterest = parts.find((r) => r.loanPart === "interest")?.amount ?? 0
    const principal =
      input.allocation === "manual" ? input.principal : input.allocation === "principal" ? input.amount - plannedInterest : plannedPrincipal
    if (principal === undefined || principal < 0 || principal > input.amount)
      throw new AppError("loan.paymentSplit")
    const interest = input.amount - principal
    if (principal > ledgerDebt(loan, data, today)) throw new AppError("loan.paymentExceedsBalance")
    const allocation = { principal, interest }
    for (const part of ["principal", "interest"] as const) {
      const before = parts.find((r) => r.loanPart === part)
      const value = allocation[part]
      if (before && value === 0)
        await tx.delete(transactions).where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.id, before.id)))
      else if (before)
        await tx
          .update(transactions)
          .set({
            amount: value,
            date: input.date,
            status: "posted",
            postedAt: new Date(),
            version: before.version + 1,
            updatedBy: ctx.userId,
          })
          .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.id, before.id)))
      else if (value > 0) {
        const planned = plannedParts(
          loan,
          {
            n: 0,
            date: ref.loanDueDate!,
            principal,
            interest,
            payment: input.amount,
            balance: 0,
            kind: "scheduled",
          },
          ctx.locale ?? "ru",
        ).find((r) => r.loanPart === part)!
        await tx.insert(transactions).values({
          ...planned,
          amount: value,
          date: input.date,
          status: "posted",
          postedAt: new Date(),
          version: 2,
          updatedBy: ctx.userId,
        })
      }
    }
    const [updated] = await tx
      .update(loans)
      .set({ version: loan.version + 1 })
      .where(and(eq(loans.householdId, ctx.householdId), eq(loans.id, loan.id)))
      .returning()
    await regenerate(tx, updated!, addDays(ref.loanDueDate!, 1), today, ctx.locale)
    await audit(
      {
        action: "loan.payment_confirm",
        entityType: "loan",
        entityId: loan.id,
        householdId: ctx.householdId,
        actorId: ctx.userId,
        meta: { dueDate: ref.loanDueDate, date: input.date, ...allocation },
      },
      tx,
    )
  })
}

export async function closeLoan(ctx: HouseholdCtx, id: string, version: number) {
  assertCan(ctx, "loans.manage")
  z.number().int().positive().parse(version)
  await getDb().transaction(async (tx) => {
    const loan = await owned(tx, ctx, id, true)
    if (loan.version !== version) throw conflict()
    const data = await ledger(tx, loan)
    if (ledgerDebt(loan, data, todayIn(ctx.timezone)) !== 0) throw new AppError("loan.debtRemaining")
    const resolved = new Set(data.rows.filter((r) => r.status !== "planned").map((r) => r.loanDueDate))
    if (
      data.rows.some((r) => r.status === "planned" && r.loanPart === "interest") ||
      schedule(loan, data.events, data.posted).some((r) => r.kind === "scheduled" && r.interest > 0 && !resolved.has(r.date))
    )
      throw new AppError("loan.interestRemaining")
    await tx
      .delete(transactions)
      .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.loanId, id), eq(transactions.status, "planned")))
    await tx
      .update(loans)
      .set({ status: "closed", version: loan.version + 1 })
      .where(and(eq(loans.householdId, ctx.householdId), eq(loans.id, id)))
    await audit({ action: "loan.close", entityType: "loan", entityId: id, householdId: ctx.householdId, actorId: ctx.userId }, tx)
  })
}

export async function deleteLoan(ctx: HouseholdCtx, id: string, version: number) {
  assertCan(ctx, "loans.manage")
  z.number().int().positive().parse(version)
  await getDb().transaction(async (tx) => {
    const loan = await owned(tx, ctx, id, true)
    if (loan.version !== version) throw conflict()
    const [used] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(
        and(
          eq(transactions.householdId, ctx.householdId),
          sql`((${transactions.loanId} = ${id} and ${transactions.status} = 'posted') or (${transactions.loanId} is distinct from ${id} and (${transactions.accountId} = ${loan.accountId} or ${transactions.toAccountId} = ${loan.accountId})))`,
        ),
      )
      .limit(1)
    if (used) throw new AppError("loan.historyExists")
    await tx.delete(transactions).where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.loanId, id)))
    await tx.delete(loans).where(and(eq(loans.householdId, ctx.householdId), eq(loans.id, id)))
    await tx
      .delete(financialAccounts)
      .where(and(eq(financialAccounts.householdId, ctx.householdId), eq(financialAccounts.id, loan.accountId)))
    await audit({ action: "loan.delete", entityType: "loan", entityId: id, householdId: ctx.householdId, actorId: ctx.userId }, tx)
  })
}

export async function virtualLoanPayments(ctx: HouseholdCtx, from: string, to: string) {
  assertCan(ctx, "finance.read")
  const ids = await getDb()
    .select()
    .from(loans)
    .where(and(eq(loans.householdId, ctx.householdId), eq(loans.status, "active")))
  const out = []
  for (const loan of ids) {
    const data = await ledger(getDb(), loan)
    const [account] = await getDb()
      .select({ name: financialAccounts.name })
      .from(financialAccounts)
      .where(and(eq(financialAccounts.householdId, ctx.householdId), eq(financialAccounts.id, loan.accountId)))
    const taken = new Set(data.rows.map((r) => r.loanDueDate))
    const locale = ctx.locale ?? (await loanCreatorLocale(getDb(), loan))
    for (const r of schedule(loan, data.events, data.posted)) {
      if (r.kind !== "scheduled" || r.date < from || r.date > to || taken.has(r.date)) continue
      out.push(
        ...plannedParts(loan, r, locale).map((p) => ({
          ...p,
          ruleId: null,
          title: assetTranslator("loans", locale)("generated.namedPayment", { name: account!.name }),
          toAmount: null,
          toAccountId: "toAccountId" in p ? p.toAccountId : null,
          categoryId: "categoryId" in p ? p.categoryId : null,
        })),
      )
    }
  }
  return out
}
