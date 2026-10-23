"use server"

import { revalidatePath } from "next/cache"
import { actionHousehold, actionSystemAdmin } from "@/server/session"
import { runAction } from "@/server/errors"
import { configForInput, saveAiSettings, verifyConnection, type SettingsInput } from "@/server/ai/config"
import { listModels } from "@/server/ai/providers"
import { saveHouseholdAi } from "@/server/ai/access"
import { createConversation, deleteConversation } from "@/server/ai/conversations"
import { applyProposal, dismissProposal } from "@/server/ai/proposals"

const refresh = () => revalidatePath("/", "layout")
export async function saveAiSettingsAction(input: SettingsInput) {
  return runAction(async () => {
    const admin = await actionSystemAdmin()
    await saveAiSettings(admin.id, input)
    refresh()
  })
}
export async function testAiConnectionAction(input: SettingsInput) {
  return runAction(async () => {
    await actionSystemAdmin()
    await verifyConnection(await configForInput(input))
    refresh()
  })
}
export async function listAiModelsAction(input: SettingsInput) {
  return runAction(async () => {
    await actionSystemAdmin()
    return listModels(await configForInput({ ...input, enabled: false }))
  })
}
export async function saveHouseholdAiAction(input: Parameters<typeof saveHouseholdAi>[1]) {
  return runAction(async () => {
    await saveHouseholdAi(await actionHousehold(), input)
    refresh()
  })
}
export async function createAiConversationAction() {
  return runAction(async () => {
    const row = await createConversation(await actionHousehold())
    refresh()
    return { id: row.id }
  })
}
export async function deleteAiConversationAction(id: string) {
  return runAction(async () => {
    await deleteConversation(await actionHousehold(), id)
    refresh()
  })
}
export async function applyAiProposalAction(id: string, itemIds: string[]) {
  return runAction(async () => {
    const result = await applyProposal(await actionHousehold(), id, itemIds)
    refresh()
    return result
  })
}
export async function dismissAiProposalAction(id: string) {
  return runAction(async () => {
    await dismissProposal(await actionHousehold(), id)
    refresh()
  })
}

export async function startBudgetInterviewAction() {
  return runAction(async () => {
    const { startBudgetInterview } = await import("@/server/ai/interview")
    const result = await startBudgetInterview(await actionHousehold())
    refresh()
    return result
  })
}
