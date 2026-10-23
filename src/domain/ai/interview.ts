import { z } from "zod"
import type { UIMessage } from "ai"

export const INTERVIEW_STEPS = ["income", "fixed", "variable", "goals", "preferences"] as const
export const interviewStepInput = z.object({
  step: z.enum(INTERVIEW_STEPS),
  questions: z.array(z.string().trim().min(1).max(400)).min(1).max(2),
  quickReplies: z.array(z.string().trim().min(1).max(160)).max(6).default([]),
})
export function interviewProgress(messages: UIMessage[]) {
  for (const message of messages.toReversed()) {
    for (const part of message.parts.toReversed()) {
      if (part.type === "tool-interview_step" && "output" in part) {
        const result = interviewStepInput.safeParse(part.output)
        if (result.success) return { ...result.data, messageId: message.id }
      }
    }
  }
  return null
}
