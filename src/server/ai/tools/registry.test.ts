import { describe, expect, it } from "vitest"
import { toolRegistry } from "./index"
import { proposalHandlers } from "../proposal-registry"
import { fingerprint } from "../config"

describe("AI schemas", () => {
  it("registers the complete foundation surface with bounded inputs", () => {
    expect([...toolRegistry.values()].filter((t) => t.kind === "read")).toHaveLength(11)
    expect([...toolRegistry.values()].filter((t) => t.kind === "propose")).toHaveLength(6)
    expect(proposalHandlers.size).toBe(13)
    expect(toolRegistry.get("get_spending")!.inputSchema.safeParse({ from: "2020-01-01", to: "2026-01-01" }).success).toBe(false)
    expect(toolRegistry.get("get_forecast")!.inputSchema.safeParse({ days: 367 }).success).toBe(false)
    expect(
      toolRegistry.get("propose_budget_changes")!.inputSchema.safeParse({
        title: "Budget",
        items: [{ type: "budget.set", input: { categoryId: crypto.randomUUID(), amount: 1.5 } }],
      }).success,
    ).toBe(false)
    expect(
      toolRegistry.get("propose_budget_changes")!.inputSchema.safeParse({ title: "Budget", items: [{ type: "execute_sql", input: {} }] })
        .success,
    ).toBe(false)
    expect(
      proposalHandlers
        .get("account.create")!
        .schema.safeParse({ name: "Account", kind: "cash", openingBalance: Number.MAX_SAFE_INTEGER + 1 }).success,
    ).toBe(false)
  })
  it("fingerprints JSONB snapshots independently of object key order", () => {
    expect(fingerprint({ a: 1, nested: { b: 2, c: 3 } })).toBe(fingerprint({ nested: { c: 3, b: 2 }, a: 1 }))
  })
})
