"use server"

import { revalidatePath } from "next/cache"
import { runAction } from "@/server/errors"
import { actionHousehold } from "@/server/session"
import * as recurring from "@/server/services/recurring"
import * as tx from "@/server/services/transactions"

const refresh = () => revalidatePath("/", "layout")

export async function createTransactionAction(input: tx.TransactionInput) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    const row = await tx.createTransaction(ctx, input)
    refresh()
    return { id: row.id }
  })
}

export async function updateTransactionAction(id: string, input: tx.TransactionInput & { version: number }) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    await tx.updateTransaction(ctx, id, input)
    refresh()
  })
}

export async function deleteTransactionAction(id: string) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    const res = await tx.deleteTransaction(ctx, id)
    refresh()
    return res
  })
}

export async function confirmTransactionAction(id: string, input: { version: number; amount?: number; date?: string }) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    await tx.confirmTransaction(ctx, id, input)
    refresh()
  })
}

export async function unconfirmTransactionAction(id: string, version: number) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    await tx.unconfirmTransaction(ctx, id, version)
    refresh()
  })
}

export async function skipTransactionAction(id: string, version: number) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    await tx.skipTransaction(ctx, id, version)
    refresh()
  })
}

export async function getTransactionAction(id: string) {
  return runAction(async () => tx.getTransaction(await actionHousehold(), id))
}

/** Turns a projected (virtual) occurrence into a real planned row so it can be edited. */
export async function materializeOccurrenceAction(ruleId: string, date: string) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    const id = await recurring.materializeOccurrence(ctx, ruleId, date)
    refresh()
    return tx.getTransaction(ctx, id)
  })
}

export async function createRulesAction(input: Parameters<typeof recurring.createRules>[1]) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    const rows = await recurring.createRules(ctx, input)
    refresh()
    return { count: rows.length }
  })
}

export async function getRuleAction(id: string) {
  return runAction(async () => recurring.getRule(await actionHousehold(), id))
}

export async function updateRuleAction(id: string, input: Parameters<typeof recurring.updateRule>[2]) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    await recurring.updateRule(ctx, id, input)
    refresh()
  })
}

export async function stopRuleAction(id: string, endDate?: string) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    await recurring.stopRule(ctx, id, endDate)
    refresh()
  })
}

export async function deleteRuleAction(id: string) {
  return runAction(async () => {
    const ctx = await actionHousehold()
    await recurring.deleteRule(ctx, id)
    refresh()
  })
}
