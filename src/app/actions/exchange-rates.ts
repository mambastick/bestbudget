"use server"

import { revalidatePath } from "next/cache"
import { addDays, todayIn } from "@/lib/dates"
import { CURRENCY_CODES, type Currency } from "@/lib/currencies"
import { z } from "zod"
import { audit } from "@/server/audit"
import { AppError, runAction } from "@/server/errors"
import { actionHousehold, actionSystemAdmin } from "@/server/session"
import { quoteConversion, refreshCbrHistory, refreshCbrRates, saveManualRate } from "@/server/services/exchange-rates"

export async function refreshExchangeRatesAction(date: string, currency: Currency) {
  return runAction(async () => {
    const admin = await actionSystemAdmin()
    if (date > todayIn("Europe/Moscow")) throw new AppError("exchangeRates.futureDate")
    z.enum(CURRENCY_CODES).parse(currency)
    const refreshed = date === todayIn("Europe/Moscow")
      ? await refreshCbrRates(date, true)
      : currency !== "RUB" && await refreshCbrHistory(currency, addDays(date, -14), date, true)
    if (!refreshed) throw new AppError("exchangeRates.unavailable")
    await audit({ action: "exchange_rate.refresh", entityType: "exchange_rate", actorId: admin.id, meta: { date, currency } })
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
