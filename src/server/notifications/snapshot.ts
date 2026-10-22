import "server-only"
import type { NoticeSnapshot } from "@/domain/notifications"
import { addDays, startOfMonth, todayIn } from "@/lib/dates"
import { assertCan, type HouseholdCtx } from "@/server/context"
import { getHousehold } from "@/server/services/households"
import { getBudgets } from "@/server/services/budgets"
import { projection } from "@/server/services/reports"
import { listInRange } from "@/server/services/transactions"

export async function notificationSnapshot(ctx: HouseholdCtx, now: Date): Promise<NoticeSnapshot> {
  assertCan(ctx, "finance.read")
  const today = todayIn(ctx.timezone, now)
  const [payments, forecast, budgets, household] = await Promise.all([
    listInRange(ctx, today, addDays(today, 30), { overdueBefore: today }),
    projection(ctx, today, addDays(today, 30), today),
    getBudgets(ctx, startOfMonth(today)),
    getHousehold(ctx),
  ])
  return {
    name: household.name,
    householdId: ctx.householdId,
    currency: ctx.currency,
    payments,
    forecast: forecast.days,
    budgets,
  }
}
