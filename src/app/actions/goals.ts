"use server"

import { revalidatePath } from "next/cache"
import { runAction } from "@/server/errors"
import { actionHousehold } from "@/server/session"
import * as goals from "@/server/services/goals"

const refresh = () => revalidatePath("/", "layout")

export async function createGoalAction(input: goals.GoalInput) {
  return runAction(async () => {
    const goal = await goals.createGoal(await actionHousehold(), input)
    refresh()
    return { id: goal.id }
  })
}

export async function updateGoalAction(id: string, input: goals.GoalInput & { version: number }) {
  return runAction(async () => {
    await goals.updateGoal(await actionHousehold(), id, input)
    refresh()
  })
}

export async function setGoalArchivedAction(id: string, version: number, archived: boolean) {
  return runAction(async () => {
    await goals.setGoalArchived(await actionHousehold(), id, version, archived)
    refresh()
  })
}

export async function contributeToGoalAction(id: string, input: Parameters<typeof goals.contributeToGoal>[2]) {
  return runAction(async () => {
    await goals.contributeToGoal(await actionHousehold(), id, input)
    refresh()
  })
}

export async function transferToGoalAction(id: string, input: Parameters<typeof goals.transferToGoal>[2]) {
  return runAction(async () => {
    await goals.transferToGoal(await actionHousehold(), id, input)
    refresh()
  })
}

export async function automateGoalAction(id: string, input: Parameters<typeof goals.automateGoal>[2]) {
  return runAction(async () => {
    await goals.automateGoal(await actionHousehold(), id, input)
    refresh()
  })
}

export async function stopGoalAutomationAction(id: string) {
  return runAction(async () => {
    await goals.stopGoalAutomation(await actionHousehold(), id)
    refresh()
  })
}
