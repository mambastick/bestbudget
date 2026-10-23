"use server"

import { revalidatePath } from "next/cache"
import { runAction } from "@/server/errors"
import { actionHousehold } from "@/server/session"
import * as loans from "@/server/services/loans"
import { getTransaction } from "@/server/services/transactions"

const refresh = () => revalidatePath("/", "layout")

export async function createLoanAction(input: loans.LoanInput) {
  return runAction(async () => {
    const row = await loans.createLoan(await actionHousehold(), input)
    refresh()
    return { id: row.id }
  })
}

export async function addLoanEventAction(id: string, version: number, input: Parameters<typeof loans.addLoanEvent>[3]) {
  return runAction(async () => {
    await loans.addLoanEvent(await actionHousehold(), id, version, input)
    refresh()
  })
}

export async function confirmLoanPaymentAction(id: string, input: Parameters<typeof loans.confirmLoanPayment>[2]) {
  return runAction(async () => {
    await loans.confirmLoanPayment(await actionHousehold(), id, input)
    refresh()
  })
}

export async function materializeLoanPaymentAction(id: string, date: string) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    const transactionId = await loans.materializeLoanPayment(ctx, id, date)
    refresh()
    return getTransaction(ctx, transactionId)
  })
}

export async function closeLoanAction(id: string, version: number) {
  return runAction(async () => {
    await loans.closeLoan(await actionHousehold(), id, version)
    refresh()
  })
}

export async function deleteLoanAction(id: string, version: number) {
  return runAction(async () => {
    await loans.deleteLoan(await actionHousehold(), id, version)
    refresh()
  })
}
