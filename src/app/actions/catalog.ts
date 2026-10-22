"use server"

import { revalidatePath } from "next/cache"
import { runAction } from "@/server/errors"
import { actionHousehold } from "@/server/session"
import { setBudget } from "@/server/services/budgets"
import * as catalog from "@/server/services/catalog"

const refresh = () => revalidatePath("/", "layout")

export async function createCategoryAction(input: Parameters<typeof catalog.createCategory>[1]) {
  return runAction(async () => {
    const row = await catalog.createCategory(await actionHousehold(), input)
    refresh()
    return { id: row.id }
  })
}

export async function updateCategoryAction(id: string, input: Parameters<typeof catalog.updateCategory>[2]) {
  return runAction(async () => {
    await catalog.updateCategory(await actionHousehold(), id, input)
    refresh()
  })
}

export async function setCategoryArchivedAction(id: string, archived: boolean) {
  return runAction(async () => {
    await catalog.setCategoryArchived(await actionHousehold(), id, archived)
    refresh()
  })
}

export async function deleteCategoryAction(id: string) {
  return runAction(async () => {
    await catalog.deleteCategory(await actionHousehold(), id)
    refresh()
  })
}

export async function createAccountAction(input: Parameters<typeof catalog.createAccount>[1]) {
  return runAction(async () => {
    const row = await catalog.createAccount(await actionHousehold(), input)
    refresh()
    return { id: row.id }
  })
}

export async function updateAccountAction(id: string, input: Parameters<typeof catalog.updateAccount>[2]) {
  return runAction(async () => {
    await catalog.updateAccount(await actionHousehold(), id, input)
    refresh()
  })
}

export async function setAccountArchivedAction(id: string, archived: boolean) {
  return runAction(async () => {
    await catalog.setAccountArchived(await actionHousehold(), id, archived)
    refresh()
  })
}

export async function deleteAccountAction(id: string) {
  return runAction(async () => {
    await catalog.deleteAccount(await actionHousehold(), id)
    refresh()
  })
}

export async function setBudgetAction(input: Parameters<typeof setBudget>[1]) {
  return runAction(async () => {
    await setBudget(await actionHousehold(), input)
    refresh()
  })
}
