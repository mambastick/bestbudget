/**
 * Fills an empty RUB household with six months of synthetic family finances.
 * For local development only: pnpm db:seed-demo admin@example.test
 */
import { and, eq } from "drizzle-orm"
import { closeDb, getDb } from "../src/db"
import { exchangeRates, goals, recurringRules, transactions, users } from "../src/db/schema"
import { addDays, addMonths, startOfMonth, todayIn } from "../src/lib/dates"
import { createAccount, listAccounts, listCategories } from "../src/server/services/catalog"
import { listMemberships, resolveHouseholdCtx } from "../src/server/services/households"
import { confirmLoanPayment, createLoan, getLoan } from "../src/server/services/loans"
import { createRules } from "../src/server/services/recurring"
import { createTransaction } from "../src/server/services/transactions"
import { automateGoal, contributeToGoal, createGoal } from "../src/server/services/goals"
import { setBudget } from "../src/server/services/budgets"

const email = process.argv[2]
if (!email) throw new Error("usage: seed-demo <email>")

try {
  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.email, email))
  if (!user) throw new Error(`user ${email} not found`)
  const [first] = await listMemberships(user.id)
  if (!first) throw new Error("the user has no household yet")
  const ctx = (await resolveHouseholdCtx(user.id, first.id))!
  const accounts = await listAccounts(ctx)
  const [main] = accounts
  const [operation] = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.householdId, ctx.householdId)).limit(1)
  const [rule] = await db.select({ id: recurringRules.id }).from(recurringRules).where(eq(recurringRules.householdId, ctx.householdId)).limit(1)
  const [goal] = await db.select({ id: goals.id }).from(goals).where(eq(goals.householdId, ctx.householdId)).limit(1)
  if (ctx.currency !== "RUB" || !main || accounts.length !== 1 || main.openingBalance !== 0 || operation || rule || goal) {
    throw new Error("seed-demo requires an empty RUB household with its single default account; create a new demo household/user")
  }
  const today = todayIn(ctx.timezone)
  const start = startOfMonth(today)
  const historyStart = addMonths(start, -5)
  const cats = await listCategories(ctx)
  const cat = (name: string) => cats.find((c) => c.name === name)!.id
  const rub = (n: number) => n * 100
  const card = await createAccount(ctx, { name: "Кредитная карта", kind: "credit_card", openingBalance: -rub(18_500), creditLimit: rub(150_000) })
  const savings = await createAccount(ctx, { name: "Накопительный", kind: "savings", openingBalance: rub(190_000) })
  const usd = await createAccount(ctx, { name: "USD-накопления", kind: "savings", currency: "USD", openingBalance: 100_00 })
  await createAccount(ctx, { name: "EUR в поездке", kind: "cash", currency: "EUR", openingBalance: 50_00 })

  // Synthetic rates make the demo reproducible offline; never replace existing publications.
  for (let date = historyStart; date <= today; date = addDays(date, 1)) {
    await db.insert(exchangeRates).values([
      { currency: "USD", date, rateToRub: "95", source: "manual" },
      { currency: "EUR", date, rateToRub: "100", source: "manual" },
    ]).onConflictDoNothing()
  }

  for (let month = historyStart; month <= start; month = addMonths(month, 1)) {
    const history = [
      [5, 125_000, "Зарплата", "Зарплата · Алексей", "income"],
      [20, 85_000, "Аванс", "Аванс · Мария", "income"],
      [1, 6_500, "Семья", "Детский сад", "expense"],
      [3, 1_400, "Подписки", "Интернет и связь", "expense"],
      [10, 8_900, "ЖКХ", "Квартплата", "expense"],
      [6, 2_350, "Рестораны и доставка", "Ужин в кафе", "expense"],
      [17, 4_200, "Рестораны и доставка", "Семейный ужин", "expense"],
      [12, 4_800, "Транспорт", "Проезд и такси", "expense"],
      [18, 399, "Подписки", "Яндекс Плюс", "expense"],
      [15, 3_100, "Здоровье", "Аптека", "expense"],
      [21, 1_650, "Развлечения", "Кино всей семьёй", "expense"],
    ] as const
    for (const [day, amount, category, title, type] of history) {
      const date = addDays(month, day - 1)
      if (date > today) continue
      await createTransaction(ctx, { type, amount: rub(amount), categoryId: cat(category), accountId: main.id, date, status: "posted", title })
    }
    for (const day of [2, 9, 16, 23]) {
      const date = addDays(month, day - 1)
      if (date > today) continue
      await createTransaction(ctx, { type: "expense", amount: rub(7_000 + day * 30) + 49, categoryId: cat("Продукты"), accountId: main.id, date, status: "posted", title: "Продукты на неделю" })
    }
    const date = addDays(month, 19)
    if (date <= today) await createTransaction(ctx, { type: "transfer", amount: rub(10_000), accountId: main.id, toAccountId: savings.id, date, status: "posted", title: "В семейную копилку" })
  }

  const monthly = (title: string, category: string, amount: number, day: number, type: "income" | "expense" = "expense") =>
    createRules(ctx, { rule: { type, title, amount: rub(amount), categoryId: cat(category), accountId: main.id, frequency: "monthly", dayOfMonth: day, startDate: addDays(today, 1) } })
  await monthly("Зарплата · Алексей", "Зарплата", 125_000, 5, "income")
  await monthly("Аванс · Мария", "Аванс", 85_000, 20, "income")
  await monthly("ЖКХ", "ЖКХ", 8_900, 10)
  await monthly("Интернет и связь", "Подписки", 1_400, 3)
  await monthly("Яндекс Плюс", "Подписки", 399, 18)
  await monthly("Детский сад", "Семья", 6_500, 1)
  await createRules(ctx, { rule: { type: "expense", title: "Продукты на неделю", amount: rub(7_500), categoryId: cat("Продукты"), accountId: main.id, frequency: "weekly", startDate: addDays(today, 3) } })
  await createRules(ctx, { rule: { type: "transfer", title: "Пополнение кредитной карты", amount: rub(5_000), accountId: main.id, toAccountId: card.id, frequency: "monthly", dayOfMonth: 25, startDate: addDays(today, 1) } })
  await createTransaction(ctx, { type: "expense", amount: rub(12_990), categoryId: cat("Одежда"), accountId: card.id, date: addDays(today, -6), status: "posted", title: "Осенняя куртка" })
  await createTransaction(ctx, { type: "expense", amount: rub(45_000), categoryId: cat("Путешествия"), accountId: main.id, date: addDays(today, 24), status: "planned", title: "Билеты в отпуск" })
  await createTransaction(ctx, { type: "transfer", amount: rub(9_500), toAmount: 100_00, accountId: main.id, toAccountId: usd.id, date: today, status: "posted", title: "Обмен RUB → USD" })

  const mortgage = await createLoan(ctx, { name: "Семейная ипотека", lender: "Семейный банк", kind: "mortgage", principal: rub(6_000_000), trackingBalance: rub(4_850_000), annualRate: "9.5", startDate: addMonths(historyStart, -36), trackingDate: historyStart, firstPaymentDate: addDays(historyStart, 9), termMonths: 144, paymentDay: 10, scheduleType: "annuity", interestMethod: "daily_actual", paymentAccountId: main.id })
  for (;;) {
    const detail = await getLoan(ctx, mortgage.id)
    const payment = detail.next
    if (!payment?.id || payment.date > today) break
    const [row] = await db.select({ version: transactions.version }).from(transactions).where(and(eq(transactions.householdId, ctx.householdId), eq(transactions.id, payment.id)))
    await confirmLoanPayment(ctx, payment.id, { version: row!.version, date: payment.date, amount: payment.payment, allocation: "principal" })
  }
  await createLoan(ctx, { name: "Ремонт квартиры", lender: "Банк Пример", kind: "consumer", principal: rub(300_000), trackingBalance: rub(300_000), annualRate: "18", startDate: today, trackingDate: today, firstPaymentDate: addMonths(today, 1), termMonths: 24, paymentDay: Number(today.slice(8)), scheduleType: "differentiated", interestMethod: "monthly", paymentAccountId: main.id })
  for (const [category, amount] of [["Продукты", 35_000], ["Рестораны и доставка", 8_000], ["Развлечения", 5_000], ["Транспорт", 6_000], ["Одежда", 15_000]] as const) {
    await setBudget(ctx, { categoryId: cat(category), amount: rub(amount) })
  }

  await createGoal(ctx, { name: "Подушка безопасности", kind: "account", accountId: savings.id, currency: "RUB", targetAmount: 1, expenseMonths: 6, expenseWindow: 3, priority: 1, allocatedAmount: rub(150_000), icon: "piggy-bank", color: "#10b981" })
  const vacation = await createGoal(ctx, { name: "Семейный отпуск", kind: "account", accountId: savings.id, currency: "RUB", targetAmount: rub(300_000), targetDate: addMonths(today, 8), priority: 2, icon: "plane", color: "#3b82f6" })
  await automateGoal(ctx, vacation.id, { accountId: main.id, day: 5, version: vacation.version })
  const car = await createGoal(ctx, { name: "Новая машина", kind: "manual", currency: "USD", targetAmount: 15_000_00, targetDate: addMonths(today, 24), icon: "car", color: "#8b5cf6" })
  for (const offset of [-3, -2, -1]) await contributeToGoal(ctx, car.id, { date: addMonths(today, offset), amount: 500_00, comment: "Ежемесячный взнос" })
  console.log(`Demo data added to «${first.name}» (synthetic FX: USD=95 RUB, EUR=100 RUB)`)
} finally {
  await closeDb()
}
