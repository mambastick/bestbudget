"use server"

import { revalidatePath } from "next/cache"
import { todayIn } from "@/lib/dates"
import { audit } from "@/server/audit"
import { AppError, runAction } from "@/server/errors"
import { actionHousehold, actionSystemAdmin } from "@/server/session"
import { quoteConversion, refreshCbrRates, saveManualRate } from "@/server/services/exchange-rates"

export async function refreshExchangeRatesAction(date: string) {
  return runAction(async () => {
    const admin = await actionSystemAdmin()
    if (date > todayIn("Europe/Moscow")) throw new AppError("Выберите сегодняшнюю или прошедшую дату")
    if (!await refreshCbrRates(date, true)) throw new AppError("ЦБ недоступен или FX_PROVIDER=none. Сохранённые курсы продолжают действовать.")
    await audit({ action: "exchange_rate.refresh", entityType: "exchange_rate", actorId: admin.id, meta: { date } })
    revalidatePath("/", "layout")
  })
}

export async function saveManualRateAction(input: Parameters<typeof saveManualRate>[1]) {
  return runAction(async () => {
    await saveManualRate((await actionSystemAdmin()).id, input)
    revalidatePath("/", "layout")
  })
}

export async function quoteConversionAction(amount: number, from: string, to: string, date: string) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    const today = todayIn(ctx.timezone)
    return quoteConversion(amount, from, to, date > today ? today : date, today)
  })
}
