import "server-only"
import { tool, type ToolSet } from "ai"
import { z } from "zod"
import type { HouseholdCtx } from "@/server/context"
import { AppError } from "@/server/errors"
import { getConversation } from "../conversations"
import { requireAi } from "../access"

export interface ToolContext {
  ctx: HouseholdCtx
  conversationId: string
  messageId: string
  kind?: "chat" | "onboarding" | "review"
}
export interface AiTool {
  name: string
  description: string
  kind: "read" | "propose"
  detailed?: boolean
  conversationKinds?: readonly ("chat" | "onboarding" | "review")[]
  inputSchema: z.ZodType
  execute(input: unknown, context: ToolContext): Promise<unknown>
}
export const toolRegistry = new Map<string, AiTool>()
export function registerTool<T>(
  definition: Omit<AiTool, "inputSchema" | "execute"> & {
    inputSchema: z.ZodType<T>
    execute(input: T, context: ToolContext): Promise<unknown>
  },
) {
  if (toolRegistry.has(definition.name)) throw new Error("DuplicateAiTool")
  toolRegistry.set(definition.name, {
    ...definition,
    execute: (input, context) => definition.execute(definition.inputSchema.parse(input), context),
  })
}
export async function buildTools(context: ToolContext) {
  const { view } = await requireAi(context.ctx)
  const conversation = await getConversation(context.ctx, context.conversationId)
  const tools: ToolSet = {}
  let calls = 0
  for (const definition of toolRegistry.values()) {
    if (definition.conversationKinds && !definition.conversationKinds.includes(conversation.kind)) continue
    if (definition.detailed && view.dataLevel !== "detailed") continue
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: async (input) => {
        // Recheck consent and membership before each tool; never trust the model's identity claims.
        const access = await requireAi(context.ctx)
        if (definition.detailed && access.view.dataLevel !== "detailed") throw new AppError("ai.detailedRequired")
        if (++calls > 32) throw new AppError("ai.toolLimit")
        try {
          const result = await definition.execute(input, { ...context, ctx: access.ctx, kind: conversation.kind })
          if (Buffer.byteLength(JSON.stringify(result)) > 24_000)
            return { error: "result_too_large", instruction: "Narrow the period or use pagination." }
          return result
        } catch (error) {
          if (error instanceof AppError) return { error: error.code, messageKey: error.messageKey }
          // Provider-facing errors must not contain SQL, financial payloads or stack traces.
          return { error: "tool_failed" }
        }
      },
    })
  }
  return tools
}
