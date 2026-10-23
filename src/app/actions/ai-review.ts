"use server"

import { revalidatePath } from "next/cache"
import { actionHousehold } from "@/server/session"
import { runAction } from "@/server/errors"
import { applyRecommendation, dismissRecommendation, discussRecommendation, runBudgetReview, saveReviewSettings } from "@/server/ai/reviews"

const refresh = () => revalidatePath("/", "layout")
export async function saveAiReviewSettingsAction(input: Parameters<typeof saveReviewSettings>[1]) {
  return runAction(async () => {
    const result = await saveReviewSettings(await actionHousehold(), input)
    refresh()
    return result
  })
}
export async function runAiReviewAction() {
  return runAction(async () => {
    const result = await runBudgetReview(await actionHousehold())
    refresh()
    return result
  })
}
export async function dismissAiRecommendationAction(id: string) {
  return runAction(async () => {
    await dismissRecommendation(await actionHousehold(), id)
    refresh()
  })
}
export async function discussAiRecommendationAction(id: string) {
  return runAction(async () => {
    const result = await discussRecommendation(await actionHousehold(), id)
    refresh()
    return result
  })
}

export async function applyAiRecommendationAction(id: string, selected: Parameters<typeof applyRecommendation>[2]) {
  return runAction(async () => {
    const result = await applyRecommendation(await actionHousehold(), id, selected)
    refresh()
    return result
  })
}
