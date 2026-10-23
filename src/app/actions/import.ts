"use server"

import { revalidatePath } from "next/cache"
import { runAction } from "@/server/errors"
import { actionHousehold } from "@/server/session"
import { commitImport, undoImport, saveCategoryRule } from "@/server/services/imports"

export async function commitImportAction(input: Parameters<typeof commitImport>[1]) {
  return runAction(async () => {
    const result = await commitImport(await actionHousehold(), input)
    revalidatePath("/", "layout")
    return result
  })
}

export async function undoImportAction(id: string) {
  return runAction(async () => {
    await undoImport(await actionHousehold(), id)
    revalidatePath("/", "layout")
  })
}

export async function saveCategoryRuleAction(input: Parameters<typeof saveCategoryRule>[1]) {
  return runAction(async () => saveCategoryRule(await actionHousehold(), input))
}
