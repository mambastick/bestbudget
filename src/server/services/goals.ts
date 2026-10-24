import "server-only"
import { assetTranslator } from "@/i18n/assets"
import { and, asc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { getDb, type DbOrTx } from "@/db"
import { financialAccounts, goalContributions, goals, recurringRules, type Goal } from "@/db/schema"
import { allocateGoals, automaticGoalSchedule, emergencyTarget, goalMetrics, safeMoney, sumMoney } from "@/domain/goals"
import { CURRENCY_CODES } from "@/lib/currencies"
import { addDays, addMonths, diffDays, formatDateFull, maxDate, startOfMonth, todayIn } from "@/lib/dates"
import { convertMinor, selectRate } from "@/lib/exchange-rates"
import { audit } from "../audit"
import { assertCan, type HouseholdCtx } from "../context"
import { AppError, conflict, notFound } from "../errors"
import { loadRates } from "./exchange-rates"
import { applyMovement, loadFinance, type Movement } from "./finance-data"
import { createRules, deleteRule, virtualOccurrences } from "./recurring"
import { createTransaction, isoDate } from "./transactions"

export const goalInput = z
  .object({
    name: z.string().trim().min(1, "validation.titleRequired").max(60),
    icon: z
      .string()
      .regex(/^[a-z0-9-]{1,40}$/)
      .default("piggy-bank"),
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .default("#10b981"),
    targetAmount: z.number().int().positive().max(100_000_000_000_000),
    currency: z.enum(CURRENCY_CODES),
    targetDate: isoDate.nullable().default(null),
    kind: z.enum(["account", "manual"]),
    accountId: z.uuid().nullable().default(null),
    allocatedAmount: z.number().int().positive().max(100_000_000_000_000).nullable().default(null),
    expenseMonths: z.number().int().min(1).max(60).nullable().default(null),
    expenseWindow: z.union([z.literal(3), z.literal(6)]).default(3),
    priority: z.number().int().min(1).max(1000).default(100),
    sortOrder: z.number().int().min(0).max(10000).default(0),
  })
  .refine((g) => (g.kind === "account") === (g.accountId !== null), { message: "validation.savingsAccount", path: ["accountId"] })
  .refine((g) => g.kind === "account" || g.allocatedAmount === null, { message: "validation.accountAllocation" })

export type GoalInput = z.input<typeof goalInput>

async function owned(db: DbOrTx, ctx: HouseholdCtx, id: string, lock = false) {
  if (!z.uuid().safeParse(id).success) throw notFound("goal.notFound")
  const query = db
    .select()
    .from(goals)
    .where(and(eq(goals.householdId, ctx.householdId), eq(goals.id, id)))
  const [goal] = await (lock ? query.for("update") : query)
  if (!goal) throw notFound("goal.notFound")
  return goal
}

async function checkAccount(db: DbOrTx, ctx: HouseholdCtx, input: z.output<typeof goalInput>) {
  if (!input.accountId) return
  const [account] = await db
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.householdId, ctx.householdId), eq(financialAccounts.id, input.accountId)))
  if (!account) throw notFound("account.notFound")
  if (account.kind !== "savings" || account.archivedAt) throw new AppError("goal.activeSavingsAccount")
}

export async function createGoal(ctx: HouseholdCtx, raw: GoalInput, plannedId?: string) {
  assertCan(ctx, "finance.write")
  const input = goalInput.parse(raw)
  return getDb().transaction(async (tx) => {
    await checkAccount(tx, ctx, input)
    const [row] = await tx
      .insert(goals)
      .values({ ...input, ...(plannedId ? { id: z.uuid().parse(plannedId) } : {}), householdId: ctx.householdId })
      .returning()
    await audit(
      {
        action: "goal.create",
        entityType: "goal",
        entityId: row!.id,
        householdId: ctx.householdId,
        actorId: ctx.userId,
        meta: { name: row!.name, kind: row!.kind },
      },
      tx,
    )
    return row!
  })
}

export async function updateGoal(ctx: HouseholdCtx, id: string, raw: GoalInput & { version: number }) {
  assertCan(ctx, "finance.write")
  const input = goalInput.parse(raw)
  const version = z.number().int().positive().parse(raw.version)
  return getDb().transaction(async (tx) => {
    const before = await owned(tx, ctx, id, true)
    if (before.kind !== input.kind || before.accountId !== input.accountId || before.currency !== input.currency) {
      throw new AppError("goal.identityLocked")
    }
    const [row] = await tx
      .update(goals)
      .set({ ...input, version: sql`${goals.version} + 1` })
      .where(and(eq(goals.householdId, ctx.householdId), eq(goals.id, id), eq(goals.version, version)))
      .returning()
    if (!row) throw conflict()
    await audit(
      { action: "goal.update", entityType: "goal", entityId: id, householdId: ctx.householdId, actorId: ctx.userId, meta: input },
      tx,
    )
    return row
  })
}

export async function setGoalArchived(ctx: HouseholdCtx, id: string, version: number, archived: boolean) {
  assertCan(ctx, "finance.write")
  z.number().int().positive().parse(version)
  // The goal lock also serializes automation creation and contributions with archiving.
  await getDb().transaction(async (tx) => {
    await owned(tx, ctx, id, true)
    const [row] = await tx
      .update(goals)
      .set({ status: archived ? "archived" : "active", version: sql`${goals.version} + 1` })
      .where(and(eq(goals.householdId, ctx.householdId), eq(goals.id, id), eq(goals.version, version)))
      .returning()
    if (!row) throw conflict()
    if (archived) {
      // Keep posted transfers; remove pending occurrences using the existing recurring service.
      const rules = await tx
        .select()
        .from(recurringRules)
        .where(and(eq(recurringRules.householdId, ctx.householdId), eq(recurringRules.goalId, id)))
      for (const rule of rules) await deleteRule(ctx, rule.id, tx)
    }
    await audit(
      {
        action: archived ? "goal.archive" : "goal.restore",
        entityType: "goal",
        entityId: id,
        householdId: ctx.householdId,
        actorId: ctx.userId,
      },
      tx,
    )
  })
}

export const contributionInput = z.object({
  date: isoDate,
  amount: z
    .number()
    .int()
    .min(-100_000_000_000_000)
    .max(100_000_000_000_000)
    .refine((a) => a !== 0, "validation.nonzero"),
  comment: z.string().trim().max(1000).default(""),
})

export async function contributeToGoal(ctx: HouseholdCtx, id: string, raw: z.input<typeof contributionInput>) {
  assertCan(ctx, "finance.write")
  const input = contributionInput.parse(raw)
  if (input.date > todayIn(ctx.timezone)) throw new AppError("goal.futureContribution")
  return getDb().transaction(async (tx) => {
    const goal = await owned(tx, ctx, id, true)
    if (goal.kind !== "manual" || goal.status === "archived") throw new AppError("goal.manualRequired")
    const previous = await tx
      .select({ amount: goalContributions.amount })
      .from(goalContributions)
      .where(and(eq(goalContributions.householdId, ctx.householdId), eq(goalContributions.goalId, id)))
    sumMoney([...previous.map((r) => r.amount), input.amount])
    const [row] = await tx
      .insert(goalContributions)
      .values({ ...input, householdId: ctx.householdId, goalId: id, createdBy: ctx.userId })
      .returning()
    await audit(
      {
        action: "goal.contribute",
        entityType: "goal",
        entityId: id,
        householdId: ctx.householdId,
        actorId: ctx.userId,
        meta: { amount: input.amount, date: input.date },
      },
      tx,
    )
    return row!
  })
}

export async function transferToGoal(
  ctx: HouseholdCtx,
  id: string,
  raw: { accountId: string; amount: number; toAmount?: number; date: string },
) {
  assertCan(ctx, "finance.write")
  return getDb().transaction(async (tx) => {
    const goal = await owned(tx, ctx, id, true)
    if (!goal.accountId || goal.status === "archived") throw new AppError("goal.inactiveAccount")
    if (isoDate.parse(raw.date) > todayIn(ctx.timezone)) throw new AppError("goal.futureTransfer")
    return createTransaction(
      ctx,
      {
        ...raw,
        type: "transfer",
        status: "posted",
        toAccountId: goal.accountId,
        title: assetTranslator("goals", ctx.locale)("generated.transfer", { name: goal.name }),
      },
      tx,
    )
  })
}

/** One ledger read and batched FX loading; no per-goal network requests. */
async function goalData(ctx: HouseholdCtx, additional: Goal[] = []) {
  assertCan(ctx, "finance.read")
  const db = getDb()
  const [rows, contributions, rules, finance] = await Promise.all([
    db.select().from(goals).where(eq(goals.householdId, ctx.householdId)).orderBy(asc(goals.priority), asc(goals.sortOrder), asc(goals.id)),
    db
      .select()
      .from(goalContributions)
      .where(eq(goalContributions.householdId, ctx.householdId))
      .orderBy(asc(goalContributions.date), asc(goalContributions.id)),
    db.select().from(recurringRules).where(eq(recurringRules.householdId, ctx.householdId)),
    loadFinance(ctx),
  ])
  rows.push(...additional)
  const today = todayIn(ctx.timezone)
  const rates = await loadRates([
    ...[...new Set([...rows.map((g) => g.currency), ...finance.accounts.map((a) => a.currency)])].map((currency) => ({
      currency,
      date: today,
    })),
    ...finance.rows
      .filter((r) => r.status === "posted" && r.type === "expense")
      .flatMap((r) =>
        rows
          .filter((g) => g.expenseMonths)
          .flatMap((g) => [
            { currency: r.currency, date: r.date },
            { currency: g.currency, date: r.date },
          ]),
      ),
  ])
  const warnings = new Set<string>()
  function convert(amount: number, from: string, to: string, date = today): number | null {
    if (from === to || amount === 0) return amount
    const a = selectRate(rates, from, date)
    const b = selectRate(rates, to, date)
    if (!a || !b) {
      warnings.add(assetTranslator("goals", ctx.locale)("warnings.missingRate", { currency: !a ? from : to }))
      return null
    }
    return convertMinor(amount, from, to, a.rateToRub, b.rateToRub)
  }
  const targets = new Map(
    rows.map((g) => {
      if (!g.expenseMonths) return [g.id, g.targetAmount] as const
      const expenses = finance.rows
        .filter(
          (r) =>
            r.type === "expense" &&
            r.status === "posted" &&
            r.date >= addMonths(startOfMonth(today), -g.expenseWindow) &&
            r.date < startOfMonth(today),
        )
        .map((r) => ({ date: r.date, amount: convert(r.amount, r.currency, g.currency, r.date) }))
      const target = expenses.some((r) => r.amount === null)
        ? null
        : emergencyTarget(expenses as { date: string; amount: number }[], today, g.expenseWindow as 3 | 6, g.expenseMonths)
      return [g.id, target] as const
    }),
  )
  const allocations = rows
    .filter((g) => g.kind === "account" && g.status !== "archived")
    .map((g) => {
      const account = finance.accountMap.get(g.accountId!)!
      const target = targets.get(g.id)!
      let converted = target === null ? null : convert(target, g.currency, account.currency)
      // Reserve enough whole account units to reach the target after the inverse conversion.
      if (converted !== null && target !== null && (convert(converted, account.currency, g.currency) ?? 0) < target)
        converted = sumMoney([converted, 1])
      // A missing target blocks lower priorities rather than silently reserving nothing.
      const shared = rows.filter((r) => r.accountId === g.accountId && r.status !== "archived").length > 1
      const cap =
        converted === null
          ? null
          : g.allocatedAmount !== null
            ? Math.min(converted, g.allocatedAmount)
            : shared
              ? converted
              : Number.MAX_SAFE_INTEGER
      return { id: g.id, accountId: account.id, priority: g.priority, sortOrder: g.sortOrder, cap, required: converted }
    })
  const accountBalances = new Map(finance.accounts.map((a) => [a.id, a.openingBalance]))
  for (const r of finance.rows.filter((r) => r.status === "posted")) applyMovement(accountBalances, r)
  const fundingGaps = new Map<string, number | null>()
  const requiredBalances = new Map<string, number | null>()
  for (const a of allocations) {
    const before = requiredBalances.get(a.accountId) ?? (requiredBalances.has(a.accountId) ? null : 0)
    const required = before === null || a.cap === null ? null : sumMoney([before, a.cap])
    fundingGaps.set(
      a.id,
      before === null || a.cap === null || a.required === null || a.cap < a.required
        ? null
        : Math.max(0, sumMoney([before, a.required, -(accountBalances.get(a.accountId) ?? 0)])),
    )
    requiredBalances.set(a.accountId, a.cap === Number.MAX_SAFE_INTEGER ? null : required)
  }
  const movements = finance.rows.filter((r) => r.status === "posted").map((r) => ({ ...r, date: r.date > today ? today : r.date }))
  function snapshot(date: string, additional: (Movement & { date: string })[] = []) {
    const balances = new Map(finance.accounts.map((a) => [a.id, a.openingBalance]))
    for (const r of [...movements, ...additional]) if (r.date <= date) applyMovement(balances, r)
    const assigned = allocateGoals(allocations, balances)
    return new Map(
      rows.map((g) => {
        const value =
          targets.get(g.id) === null || allocations.find((a) => a.id === g.id)?.cap === null
            ? null
            : g.kind === "manual"
              ? sumMoney(contributions.filter((c) => c.goalId === g.id && c.date <= date).map((c) => c.amount))
              : convert(assigned.get(g.id) ?? 0, finance.accountMap.get(g.accountId!)!.currency, g.currency)
        return [g.id, value] as const
      }),
    )
  }
  const horizon = addMonths(today, 120)
  const relevant = new Set(rows.filter((g) => g.accountId && g.status !== "archived").map((g) => g.accountId))
  const virtual = relevant.size ? await virtualOccurrences(ctx, today, horizon, today) : []
  const upcoming = [
    ...finance.rows.filter((r) => r.status === "planned" && r.date <= horizon),
    ...virtual.map((r) => ({ ...r, status: "planned" as const, count: 1, currency: finance.accountMap.get(r.accountId)!.currency })),
  ]
    .filter((r) => relevant.has(r.accountId) || relevant.has(r.toAccountId))
    .map((r) => ({ ...r, date: maxDate(today, r.date) }))
  const hasPlan = (g: { accountId: string | null }) =>
    g.accountId !== null && upcoming.some((r) => r.accountId === g.accountId || r.toAccountId === g.accountId)
  const plannedDates = new Map<string, string>()
  for (const date of [...new Set(upcoming.map((r) => r.date))].sort()) {
    const values = snapshot(date, upcoming)
    for (const goal of rows) {
      if (!plannedDates.has(goal.id) && hasPlan(goal) && targets.get(goal.id) && (values.get(goal.id) ?? 0) >= targets.get(goal.id)!)
        plannedDates.set(goal.id, date)
    }
  }
  return {
    rows,
    contributions,
    rules,
    finance,
    today,
    targets,
    snapshot,
    convert,
    warnings,
    upcoming,
    plannedDates,
    hasPlan,
    fundingGaps,
    rates,
  }
}

async function summaries(ctx: HouseholdCtx, additional: Goal[] = []) {
  const d = await goalData(ctx, additional)
  const current = d.snapshot(d.today)
  const from = addMonths(d.today, -3)
  const past = d.snapshot(addDays(from, -1))
  const result = d.rows.map((g) => {
    const target = d.targets.get(g.id) ?? null
    const progress = current.get(g.id) ?? null
    const monthlyPace =
      progress === null || past.get(g.id) == null ? 0 : Math.max(0, safeMoney((BigInt(progress) - BigInt(past.get(g.id)!)) / 3n))
    const metrics = goalMetrics({
      target: target ?? 0,
      progress: progress ?? 0,
      today: d.today,
      targetDate: g.targetDate,
      monthlyPace,
      plannedDate: d.hasPlan(g) ? (d.plannedDates.get(g.id) ?? null) : undefined,
    })
    const rateDates =
      g.accountId && d.finance.accountMap.get(g.accountId)?.currency !== g.currency
        ? [g.currency, d.finance.accountMap.get(g.accountId)!.currency]
            .map((c) => selectRate(d.rates, c, d.today))
            .filter((r) => r && diffDays(d.today, r.date) > 7)
            .map((r) =>
              assetTranslator("goals", ctx.locale)("warnings.rateDate", {
                currency: r!.currency,
                date: formatDateFull(r!.date, ctx.locale),
              }),
            )
        : []
    const rule = d.rules.find((r) => r.goalId === g.id) ?? null
    return {
      ...g,
      target,
      progress,
      monthlyPace,
      rateNote: rateDates.join(" · ") || null,
      ...metrics,
      fundingGap: d.fundingGaps.get(g.id) ?? null,
      plannedDate: d.plannedDates.get(g.id) ?? null,
      status: g.status === "archived" ? ("archived" as const) : metrics.status,
      accountName: g.accountId ? (d.finance.accountMap.get(g.accountId)?.name ?? null) : null,
      accountCurrency: g.accountId ? (d.finance.accountMap.get(g.accountId)?.currency ?? null) : null,
      automation: rule
        ? {
            id: rule.id,
            amount: rule.amount,
            currency: d.finance.accountMap.get(rule.accountId)!.currency,
            day: rule.dayOfMonth,
            endDate: rule.endDate,
          }
        : null,
    }
  })
  return { d, result }
}

export async function listGoals(ctx: HouseholdCtx) {
  const { d, result } = await summaries(ctx)
  return { goals: result, warnings: [...d.warnings], today: d.today }
}
export type GoalSummary = Awaited<ReturnType<typeof listGoals>>["goals"][number]

export async function getGoalDetail(ctx: HouseholdCtx, id: string, additional: Goal[] = []) {
  const { d, result } = await summaries(ctx, additional)
  const goal = result.find((g) => g.id === id)
  if (!goal) throw notFound("goal.notFound")
  const from = addMonths(d.today, -3)
  const history =
    goal.kind === "manual"
      ? d.contributions.filter((c) => c.goalId === id).map((c) => ({ id: c.id, date: c.date, amount: c.amount, comment: c.comment }))
      : [
          ...new Set(
            d.finance.rows
              .filter((r) => r.status === "posted" && (r.accountId === goal.accountId || r.toAccountId === goal.accountId))
              .map((r) => r.date),
          ),
        ]
          .filter((date) => date <= d.today)
          .sort()
          .map((date) => ({
            id: date,
            date,
            amount: sumMoney([d.snapshot(date).get(id) ?? 0, -(d.snapshot(addDays(date, -1)).get(id) ?? 0)]),
            comment: assetTranslator("goals", ctx.locale)("history.allocationChange"),
          }))
  const chart: { date: string; actual: number | null; forecast: number | null; planned: number | null }[] = [0, 1, 2, 3].map((i) => {
    const date = i === 3 ? d.today : addMonths(from, i)
    return {
      date,
      actual: d.snapshot(date).get(id) ?? null,
      forecast: i === 3 ? goal.progress : null,
      planned: i === 3 ? goal.progress : null,
    }
  })
  const plannedDate = d.plannedDates.get(id) ?? null
  const hasPlan = d.hasPlan(goal)
  for (let i = 1; i <= 120; i++) {
    const date = addMonths(d.today, i)
    const forecast =
      goal.progress === null ? null : Math.min(goal.target ?? 0, sumMoney([goal.progress, safeMoney(BigInt(goal.monthlyPace) * BigInt(i))]))
    const planned = hasPlan ? (d.snapshot(date, d.upcoming).get(id) ?? null) : null
    chart.push({ date, actual: null, forecast, planned })
    if (
      ((forecast !== null && forecast >= (goal.target ?? 0)) || goal.monthlyPace === 0) &&
      (!hasPlan || (plannedDate !== null && date >= plannedDate))
    )
      break
  }
  const metrics = goalMetrics({
    target: goal.target ?? 0,
    progress: goal.progress ?? 0,
    today: d.today,
    targetDate: goal.targetDate,
    monthlyPace: goal.monthlyPace,
    plannedDate: hasPlan ? plannedDate : undefined,
  })
  return {
    goal: { ...goal, ...metrics, status: goal.status === "archived" ? ("archived" as const) : metrics.status },
    history: history.reverse(),
    chart,
    warnings: [...d.warnings],
    today: d.today,
    hasPlan,
  }
}

export const goalAutomationInput = z.object({ accountId: z.uuid(), day: z.number().int().min(1).max(31), version: z.number().int().positive() })

export async function previewGoalAutomation(ctx: HouseholdCtx, id: string, raw: { accountId: string; day: number; version: number }, additional: Goal[] = []) {
  assertCan(ctx, "finance.write")
  const input = goalAutomationInput.parse(raw)
  const detail = await getGoalDetail(ctx, id, additional)
  const g = detail.goal
  if (!g.accountId || g.status === "archived" || g.target === null || g.progress === null)
    throw new AppError("goal.progressRequired")
  if (g.fundingGap === null) throw new AppError("goal.insufficientAllocation")
  if (!g.targetDate || g.targetDate <= detail.today || !g.monthlyRequired)
    throw new AppError("goal.futureTargetRequired")
  const [source] = await getDb()
    .select()
    .from(financialAccounts)
    .where(and(eq(financialAccounts.householdId, ctx.householdId), eq(financialAccounts.id, input.accountId)))
  if (!source || source.id === g.accountId) throw new AppError("goal.differentSource")
  const schedule = automaticGoalSchedule(detail.today, g.targetDate, input.day, g.fundingGap)
  if (!schedule) throw new AppError("goal.topupAfterDeadline")
  const { startDate, amount: required } = schedule
  const quote = async (required: number, to: string) => {
    const rates = await loadRates([
      { currency: g.accountCurrency!, date: detail.today },
      { currency: to, date: detail.today },
    ])
    const fromRate = selectRate(rates, g.accountCurrency!, detail.today)
    const toRate = selectRate(rates, to, detail.today)
    if (g.accountCurrency !== to && (!fromRate || !toRate)) throw new AppError("goal.rateRequired")
    return g.accountCurrency === to ? required : convertMinor(required, g.accountCurrency!, to, fromRate!.rateToRub, toRate!.rateToRub)
  }
  const amount = Math.max(1, await quote(required, source.currency))
  const toAmount = required
  return { g, input, startDate, amount, toAmount, currency: source.currency }
}

export async function automateGoal(ctx: HouseholdCtx, id: string, raw: { accountId: string; day: number; version: number }) {
  const { g, input, startDate, amount, toAmount, currency } = await previewGoalAutomation(ctx, id, raw)
  return getDb().transaction(async (tx) => {
    const before = await owned(tx, ctx, id, true)
    if (before.version !== input.version || before.status === "archived") throw conflict()
    const [existing] = await tx
      .select()
      .from(recurringRules)
      .where(and(eq(recurringRules.householdId, ctx.householdId), eq(recurringRules.goalId, id)))
    if (existing) throw new AppError("goal.topupExists")
    const [rule] = await createRules(
      ctx,
      {
        rule: {
          type: "transfer",
          title: assetTranslator("goals", ctx.locale)("generated.transfer", { name: g.name }),
          amount,
          toAmount: currency === g.accountCurrency ? undefined : toAmount,
          accountId: input.accountId,
          toAccountId: g.accountId,
          frequency: "monthly",
          dayOfMonth: input.day,
          startDate,
          endDate: g.targetDate,
        },
      },
      tx,
    )
    await tx.update(recurringRules).set({ goalId: id }).where(eq(recurringRules.id, rule!.id))
    await tx
      .update(goals)
      .set({ version: sql`${goals.version} + 1` })
      .where(eq(goals.id, id))
    await audit(
      {
        action: "goal.automate",
        entityType: "goal",
        entityId: id,
        householdId: ctx.householdId,
        actorId: ctx.userId,
        meta: { ruleId: rule!.id },
      },
      tx,
    )
    return rule!
  })
}

export async function stopGoalAutomation(ctx: HouseholdCtx, id: string) {
  assertCan(ctx, "finance.write")
  await getDb().transaction(async (tx) => {
    const goal = await owned(tx, ctx, id, true)
    const [rule] = await tx
      .select()
      .from(recurringRules)
      .where(and(eq(recurringRules.householdId, ctx.householdId), eq(recurringRules.goalId, goal.id)))
    if (rule) await deleteRule(ctx, rule.id, tx)
    await tx
      .update(goals)
      .set({ version: sql`${goals.version} + 1` })
      .where(and(eq(goals.householdId, ctx.householdId), eq(goals.id, id)))
  })
}

export const newAutomatedGoalInput = z.object({
  plannedId: z.uuid(),
  goal: goalInput,
  automation: goalAutomationInput.omit({ version: true }),
})

/** Include the prospective goal in normal allocation math without inserting a temporary financial row. */
export async function previewNewGoalAutomation(ctx: HouseholdCtx, raw: z.input<typeof newAutomatedGoalInput>) {
  const input = newAutomatedGoalInput.parse(raw)
  const id = input.plannedId
  const prospective: Goal = { ...input.goal, id, householdId: ctx.householdId, status: "active", version: 1, createdAt: new Date(), updatedAt: new Date() }
  const preview = await previewGoalAutomation(ctx, id, { ...input.automation, version: 1 }, [prospective])
  return { amount: preview.amount, toAmount: preview.toAmount, startDate: preview.startDate, endDate: preview.g.targetDate, accountId: input.automation.accountId, toAccountId: input.goal.accountId, day: input.automation.day, currency: preview.currency }
}

export async function createAutomatedGoal(ctx: HouseholdCtx, raw: z.input<typeof newAutomatedGoalInput>, expected: Awaited<ReturnType<typeof previewNewGoalAutomation>>) {
  const input = newAutomatedGoalInput.parse(raw)
  return getDb().transaction(async (tx) => {
    const { withDb } = await import("@/db")
    return withDb(tx, async () => {
      const goal = await createGoal(ctx, input.goal, input.plannedId)
      const current = await previewGoalAutomation(ctx, goal.id, { ...input.automation, version: goal.version })
      if (current.amount !== expected.amount || current.toAmount !== expected.toAmount || current.startDate !== expected.startDate) throw conflict()
      await automateGoal(ctx, goal.id, { ...input.automation, version: goal.version })
      return goal
    })
  })
}
