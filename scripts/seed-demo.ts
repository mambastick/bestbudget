/**
 * Fills the first household of a user with demo data (recurring income and payments, one-off expenses).
 * For local development only:
 *
 *   pnpm db:seed-demo admin@example.test
 */
import { eq } from "drizzle-orm"
import { closeDb, getDb } from "../src/db"
import { users } from "../src/db/schema"
import { addDays, addMonths, startOfMonth, todayIn } from "../src/lib/dates"
import { createAccount, listAccounts, listCategories } from "../src/server/services/catalog"
import { listMemberships, resolveHouseholdCtx } from "../src/server/services/households"
import { createRules } from "../src/server/services/recurring"
import { createTransaction } from "../src/server/services/transactions"
import { automateGoal, contributeToGoal, createGoal } from "../src/server/services/goals"
import { setBudget } from "../src/server/services/budgets"

const email = process.argv[2]
if (!email) throw new Error("usage: seed-demo <email>")

const [user] = await getDb().select().from(users).where(eq(users.email, email))
if (!user) throw new Error(`user ${email} not found`)
const [first] = await listMemberships(user.id)
if (!first) throw new Error("the user has no household yet")
const ctx = (await resolveHouseholdCtx(user.id, first.id))!
const today = todayIn(ctx.timezone)
const cats = await listCategories(ctx)
const cat = (name: string) => cats.find((c) => c.name === name)!.id
const [main] = await listAccounts(ctx)
const card = await createAccount(ctx, { name: "Кредитная карта", kind: "credit_card", openingBalance: -1_850_000 })
const savings = await createAccount(ctx, { name: "Накопительный", kind: "savings", openingBalance: 25_000_000 })
const usd = await createAccount(ctx, { name: "USD-накопления", kind: "savings", currency: "USD", openingBalance: 100_00 })
await createAccount(ctx, { name: "EUR в поездке", kind: "cash", currency: "EUR", openingBalance: 50_00 })
const rub = (n: number) => n * 100
const start = today.slice(0, 8) + "01"

const monthly = (title: string, category: string, amount: number, day: number, type: "income" | "expense" = "expense", accountId = main!.id) =>
  createRules(ctx, { rule: { type, title, amount: rub(amount), categoryId: cat(category), accountId, frequency: "monthly", dayOfMonth: day, startDate: start } })

await monthly("Ипотека", "Ипотека", 62_000, 15)
await monthly("Автокредит", "Кредиты", 23_500, 7)
await monthly("ЖКХ", "ЖКХ", 8_900, 10)
await monthly("Интернет и связь", "Подписки", 1_400, 3)
await monthly("Яндекс Плюс", "Подписки", 399, 18, "expense", card.id)
await monthly("Детский сад", "Семья", 6_500, 1)
await createRules(ctx, {
  rule: { type: "expense", title: "Продукты на неделю", amount: rub(7_500), categoryId: cat("Продукты"), accountId: card.id, frequency: "weekly", startDate: addDays(today, -((new Date(today).getUTCDay() + 1) % 7)) },
})
await createTransaction(ctx, { type: "income", amount: rub(210_000), categoryId: cat("Зарплата"), accountId: main!.id, date: addDays(today, -17), status: "posted", title: "Зарплата" })
for (const [days, amount, category, title] of [
  [-12, 2_350, "Рестораны и доставка", "Доставка суши"],
  [-9, 4_800, "Транспорт", "Такси за месяц"],
  [-6, 12_990, "Одежда", "Куртка"],
  [-3, 3_100, "Здоровье", "Аптека"],
  [-1, 1_650, "Развлечения", "Кино"],
] as const) {
  await createTransaction(ctx, { type: "expense", amount: rub(amount), categoryId: cat(category), accountId: card.id, date: addDays(today, days), status: "posted", title })
}
await createTransaction(ctx, { type: "expense", amount: rub(45_000), categoryId: cat("Путешествия"), accountId: main!.id, date: addDays(today, 24), status: "planned", title: "Билеты в отпуск" })
await createTransaction(ctx, { type: "transfer", amount: rub(9_500), toAmount: 100_00, accountId: main!.id, toAccountId: usd.id, date: today, status: "posted", title: "Обмен RUB → USD" })
await setBudget(ctx, { categoryId: cat("Продукты"), amount: rub(35_000) })
await setBudget(ctx, { categoryId: cat("Рестораны и доставка"), amount: rub(8_000) })
await setBudget(ctx, { categoryId: cat("Развлечения"), amount: rub(5_000) })

for (const i of [-1, -2, -3]) {
  await createTransaction(ctx, { type: "expense", amount: rub(50_000), categoryId: cat("Продукты"), accountId: main!.id, date: addMonths(startOfMonth(today), i), status: "posted", title: "Расходы прошлого месяца" })
}
await createGoal(ctx, { name: "Подушка", kind: "account", accountId: savings.id, currency: "RUB", targetAmount: 1, expenseMonths: 6, expenseWindow: 3, priority: 1, allocatedAmount: rub(150_000), icon: "piggy-bank", color: "#10b981" })
const vacation = await createGoal(ctx, { name: "Отпуск", kind: "account", accountId: savings.id, currency: "RUB", targetAmount: rub(300_000), targetDate: addMonths(today, 8), priority: 2, icon: "plane", color: "#3b82f6" })
await automateGoal(ctx, vacation.id, { accountId: main!.id, day: 5, version: vacation.version })
const car = await createGoal(ctx, { name: "Машина", kind: "manual", currency: "USD", targetAmount: 15_000_00, targetDate: addMonths(today, 24), icon: "car", color: "#8b5cf6" })
await contributeToGoal(ctx, car.id, { date: addMonths(today, -2), amount: 500_00, comment: "Начали копить" })
await contributeToGoal(ctx, car.id, { date: addMonths(today, -1), amount: 500_00, comment: "Ежемесячный взнос" })

console.log(`Demo data added to «${first.name}»`)
await closeDb()
