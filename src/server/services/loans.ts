import "server-only"
import { and, asc, eq, gte, isNull, lte, ne, notInArray, or, gt, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb, type DbOrTx } from "@/db"
import { categories, financialAccounts, loanEvents, loans, transactions, type Loan, type LoanEvent } from "@/db/schema"
import {
  calculateLoanSchedule,
  LoanCalculationError,
  termForPayment,
  type LoanEventInput,
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
  .regex(/^\d{1,3}(\.\d{1,6})?$/, "Укажите ставку до 6 знаков после запятой")
  .refine((s) => Number(s) <= 100, "Ставка должна быть от 0 до 100%")
export const loanInput = z
  .object({
    name: z.string().trim().min(1, "Укажите название").max(60),
    lender: z.string().trim().min(1, "Укажите банк").max(120),
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
  .refine((p) => p.trackingBalance <= p.principal, { message: "Остаток превышает исходную сумму", path: ["trackingBalance"] })
  .refine((p) => p.startDate <= p.trackingDate, { message: "Начало кредита позже начала учёта", path: ["startDate"] })
  .refine((p) => p.termMonths || (p.scheduleType === "annuity" && p.paymentAmount), {
    message: "Укажите оставшийся срок или аннуитетный платёж",
    path: ["termMonths"],
  })
export type LoanInput = z.input<typeof loanInput>

function checkedCalculation<T>(calculate: () => T): T {
  try {
    return calculate()
  } catch (e) {
    if (e instanceof LoanCalculationError) throw new AppError(e.message)
    throw e
  }
}

function schedule(p: Loan, events: LoanEvent[], posted: LoanPayment[]) {
  return checkedCalculation(() =>
    calculateLoanSchedule(
      p,
      events.map((e): LoanEventInput => {
        if (e.type === "rate_change") return { type: e.type, date: e.date, annualRate: e.annualRate! }
        if (e.type === "reconciliation") return { type: e.type, date: e.date, balance: e.balance! }
        return { type: e.type, date: e.date, amount: e.amount!, mode: e.mode! }
      }),
      posted,
    ),
  )
}

async function owned(db: DbOrTx, ctx: Pick<HouseholdCtx, "householdId">, id: string, lock = false) {
  if (!z.uuid().safeParse(id).success) throw notFound("Кредит не найден")
  const query = db
    .select()
    .from(loans)
    .where(and(eq(loans.id, id), eq(loans.householdId, ctx.householdId)))
  const [row] = await (lock ? query.for("update") : query)
  if (!row) throw notFound("Кредит не найден")
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
  if (input.trackingDate > todayIn(ctx.timezone)) throw new AppError("Начало учёта не может быть в будущем")
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
    if (!paymentAccount || paymentAccount.kind === "loan") throw new AppError("Выберите активный счёт оплаты")
    let categoryId = input.interestCategoryId
    if (!categoryId) {
      await tx
        .insert(categories)
        .values({
          householdId: ctx.householdId,
          kind: "expense",
          name: "Проценты по кредитам",
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
            sql`lower(${categories.name}) = lower('Проценты по кредитам')`,
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
    if (!category) throw notFound("Категория процентов не найдена")
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
    await materialize(tx, loan!, todayIn(ctx.timezone))
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

function plannedParts(loan: Loan, row: LoanScheduleRow) {
  const base = {
    householdId: loan.householdId,
    loanId: loan.id,
    loanDueDate: row.date,
    loanPaymentKey: `${loan.id}:${row.date}`,
    accountId: loan.paymentAccountId,
    date: row.date,
    status: "planned" as const,
    title: "Платёж по кредиту",
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

async function materialize(db: DbOrTx, loan: Loan, today: string, onlyDate?: string) {
  if (loan.status !== "active") return
  const data = await ledger(db, loan)
  const rows = schedule(loan, data.events, data.posted).filter(
    (r) => r.kind === "scheduled" && (onlyDate ? r.date === onlyDate : r.date <= addDays(today, 62)),
  )
  const taken = new Set(data.rows.map((r) => r.loanDueDate))
  for (const row of rows) {
    if (taken.has(row.date)) continue
    const parts = plannedParts(loan, row)
    if (parts.length)
      await db
        .insert(transactions)
        .values(parts)
        .onConflictDoNothing({ target: [transactions.loanId, transactions.loanDueDate, transactions.loanPart] })
  }
}

/** The loan row serializes materialization, payment confirmation and schedule changes. */
export async function ensureLoansMaterialized(ctx: Pick<HouseholdCtx, "householdId">, today: string) {
  const ids = await getDb()
    .select({ id: loans.id })
    .from(loans)
    .where(and(eq(loans.householdId, ctx.householdId), eq(loans.status, "active")))
  for (const { id } of ids) await getDb().transaction(async (tx) => materialize(tx, await owned(tx, ctx, id, true), today))
}

export async function materializeLoanPayment(ctx: HouseholdCtx, id: string, date: string) {
  assertCan(ctx, "finance.write")
  isoDate.parse(date)
  await getDb().transaction(async (tx) => {
    const loan = await owned(tx, ctx, id, true)
    await materialize(tx, loan, todayIn(ctx.timezone), date)
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
  if (!row) throw notFound("Платёж не найден")
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
  const paidPrincipal = data.rows.filter((r) => r.status === "posted" && r.type === "transfer").reduce((s, r) => s + r.amount, 0)
  const adjustments = data.events.reduce((s, e) => s + (e.balanceDelta ?? 0), 0)
  const debt = loan.trackingBalance - paidPrincipal - adjustments
  const planned = schedule(loan, data.events, data.posted)
  const rows = planned.map((r) => {
    const payment = data.rows.find((p) => p.loanDueDate === r.date && p.loanPart !== "prepayment")
    return { ...r, id: payment?.id ?? null, status: r.kind === "scheduled" ? (payment?.status ?? "planned") : "posted" }
  })
  const futureInterest = rows.filter((r) => r.kind === "scheduled" && r.status === "planned").reduce((s, r) => s + r.interest, 0)
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

async function regenerate(db: DbOrTx, loan: Loan, from: string, today: string) {
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
  await materialize(db, loan, today)
}

export const loanEventInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("prepayment"), date: isoDate, amount, mode: z.enum(["reduce_term", "reduce_payment"]) }),
  z.object({ type: z.literal("rate_change"), date: isoDate, annualRate: rate }),
  z.object({ type: z.literal("reconciliation"), date: isoDate, balance: z.number().int().min(0).max(100_000_000_000_000) }),
])

export async function addLoanEvent(ctx: HouseholdCtx, id: string, version: number, raw: LoanEventInput) {
  assertCan(ctx, "loans.manage")
  const input = loanEventInput.parse(raw)
  z.number().int().positive().parse(version)
  const today = todayIn(ctx.timezone)
  return getDb().transaction(async (tx) => {
    const loan = await owned(tx, ctx, id, true)
    if (loan.version !== version) throw conflict()
    if (loan.status !== "active") throw new AppError("Кредит закрыт")
    const data = await ledger(tx, loan)
    if (
      input.date < loan.trackingDate ||
      input.date > today ||
      data.events.some((e) => e.date >= input.date) ||
      data.rows.some((r) => r.status === "posted" && r.loanPart !== "prepayment" && (r.loanDueDate! > input.date || r.date > input.date))
    )
      throw new AppError("Добавляйте события по порядку, после подтверждённых платежей и не позже сегодня")
    if (input.type === "reconciliation" && data.rows.some((r) => r.status === "planned" && r.version > 1 && r.loanDueDate! <= input.date))
      throw new AppError("Сначала подтвердите изменённые вручную платежи до даты сверки")
    if (input.type !== "reconciliation" && data.rows.some((r) => r.status === "planned" && r.loanDueDate! <= input.date))
      throw new AppError("Сначала подтвердите предыдущие платежи или сверьте остаток")
    const [account] = await tx
      .select()
      .from(financialAccounts)
      .where(and(eq(financialAccounts.householdId, ctx.householdId), eq(financialAccounts.id, loan.accountId)))
    const actualDebt =
      -account!.openingBalance -
      data.rows.filter((r) => r.status === "posted" && r.type === "transfer").reduce((s, r) => s + r.amount, 0) -
      data.events.reduce((s, e) => s + (e.balanceDelta ?? 0), 0)
    const values =
      input.type === "prepayment"
        ? { ...input, amount: Math.min(input.amount, actualDebt) }
        : input.type === "reconciliation"
          ? { ...input, balanceDelta: actualDebt - input.balance }
          : input
    if (input.type === "prepayment" && actualDebt <= 0) throw new AppError("Основной долг уже погашен")
    const [event] = await tx
      .insert(loanEvents)
      .values({ ...values, loanId: id, householdId: ctx.householdId, createdBy: ctx.userId })
      .returning()
    if (input.type === "prepayment")
      await tx
        .insert(transactions)
        .values({
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
          title: "Досрочное погашение",
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
          postedAt: new Date(),
        })
    if (input.type === "reconciliation") {
      // Reconciliation supersedes unconfirmed historical slots; skipped rows reserve their keys.
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
    await regenerate(tx, updated!, input.date, today)
    await audit(
      { action: `loan.${input.type}`, entityType: "loan", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: values },
      tx,
    )
    return event!
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
  if (input.date > todayIn(ctx.timezone)) throw new AppError("Фактическая дата не может быть в будущем")
  const db = getDb()
  const [reference] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.id, z.uuid().parse(transactionId))))
  if (!reference?.loanId || reference.loanPart === "prepayment") throw notFound("Платёж не найден")
  return db.transaction(async (tx) => {
    const loan = await owned(tx, ctx, reference.loanId!, true)
    if (loan.status !== "active") throw new AppError("Кредит закрыт")
    const data = await ledger(tx, loan)
    const parts = data.rows.filter((r) => r.loanPaymentKey === reference.loanPaymentKey)
    const ref = parts.find((r) => r.id === transactionId)
    if (!ref || ref.version !== input.version) throw conflict()
    if (parts.some((r) => r.status !== "planned")) throw new AppError("Платёж уже подтверждён или пропущен")
    if (data.rows.some((r) => r.status === "planned" && r.loanPart !== "prepayment" && r.loanDueDate! < ref.loanDueDate!))
      throw new AppError("Сначала подтвердите предыдущий платёж")
    if (
      input.date < loan.trackingDate ||
      data.events.some((e) => e.date > input.date) ||
      data.rows.some((r) => r.status === "posted" && r.date > input.date)
    )
      throw new AppError("Фактическая дата раньше предыдущего события или платежа")
    const plannedPrincipal = parts.find((r) => r.loanPart === "principal")?.amount ?? 0
    const plannedInterest = parts.find((r) => r.loanPart === "interest")?.amount ?? 0
    const principal =
      input.allocation === "manual" ? input.principal : input.allocation === "principal" ? input.amount - plannedInterest : plannedPrincipal
    if (principal === undefined || principal < 0 || principal > input.amount)
      throw new AppError("Проверьте разбивку платежа на тело и проценты")
    const interest = input.amount - principal
    const debt =
      loan.trackingBalance -
      data.rows.filter((r) => r.status === "posted" && r.type === "transfer").reduce((s, r) => s + r.amount, 0) -
      data.events.reduce((s, e) => s + (e.balanceDelta ?? 0), 0)
    if (principal > debt) throw new AppError("Тело платежа превышает остаток долга")
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
        const planned = plannedParts(loan, {
          n: 0,
          date: ref.loanDueDate!,
          principal,
          interest,
          payment: input.amount,
          balance: 0,
          kind: "scheduled",
        }).find((r) => r.loanPart === part)!
        await tx
          .insert(transactions)
          .values({
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
    await regenerate(tx, updated!, addDays(ref.loanDueDate!, 1), todayIn(ctx.timezone))
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
    const debt =
      loan.trackingBalance -
      data.rows.filter((r) => r.status === "posted" && r.type === "transfer").reduce((s, r) => s + r.amount, 0) -
      data.events.reduce((s, e) => s + (e.balanceDelta ?? 0), 0)
    if (debt !== 0) throw new AppError("Сначала погасите долг или сверьте нулевой остаток с банком")
    if (data.rows.some((r) => r.status === "planned" && r.loanPart === "interest"))
      throw new AppError("Сначала подтвердите оставшиеся проценты")
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
    if (used) throw new AppError("Есть подтверждённые операции: закройте кредит, история сохранится")
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
    for (const r of schedule(loan, data.events, data.posted)) {
      if (r.kind !== "scheduled" || r.date < from || r.date > to || taken.has(r.date)) continue
      out.push(
        ...plannedParts(loan, r).map((p) => ({
          ...p,
          ruleId: null,
          title: `Платёж по кредиту: ${account!.name}`,
          toAmount: null,
          toAccountId: "toAccountId" in p ? p.toAccountId : null,
          categoryId: "categoryId" in p ? p.categoryId : null,
        })),
      )
    }
  }
  return out
}
