import "server-only"
import { proposalSchema } from "../proposal-registry"
import { createProposal } from "../proposals"
import { registerTool } from "./registry"

const groups = {
  propose_budget_changes: ["budget.set"],
  propose_recurring: ["recurring.create", "recurring.update", "recurring.pause"],
  propose_categories: ["category.create", "category.rename", "category.archive"],
  propose_goal: ["goal.create", "goal.update", "goal.automate"],
  propose_recategorize: ["transaction.recategorize", "import.rule"],
  propose_account: ["account.create"],
}
for (const [name, types] of Object.entries(groups)) {
  registerTool({
    name,
    kind: "propose",
    conversationKinds: ["chat", "review"],
    detailed: name === "propose_recategorize",
    description: `Create a pending human-reviewed proposal (${types.join(", ")}). Does not change finances. Use existing entity IDs from read tools. budget.set amount=null removes a limit. All amounts are integer minor units.`,
    inputSchema: proposalSchema(types),
    execute: (input, { ctx, conversationId, messageId }) =>
      createProposal(ctx, conversationId, messageId, input as { title: string; items: { type: string; input: unknown }[] }),
  })
}
