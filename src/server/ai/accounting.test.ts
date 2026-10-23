import { expect, it, vi } from "vitest"
import { TurnAccounting } from "./accounting"

it("uses reported usage, including zero, instead of estimates", async () => {
  const usage = new TurnAccounting(vi.fn().mockResolvedValue(undefined))
  await usage.start(10000)
  await usage.chunk({ type: "text-delta", text: "Hello" })
  await usage.complete({ inputTokens: 0, outputTokens: 0 })
  expect([usage.input, usage.output]).toEqual([0, 0])
})
it("charges only the interrupted step's context and received output", async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const usage = new TurnAccounting(save)
  await usage.start(300)
  await usage.complete({ inputTokens: 50, outputTokens: 20 })
  await usage.start(500)
  await usage.chunk({ type: "text-delta", text: "Привет" })
  await usage.reject()
  expect([usage.input, usage.output]).toEqual([550, 32])
  expect(save).toHaveBeenLastCalledWith(550, 32)
})
it("does not charge a rejected unanswered step or duplicate tool argument deltas", async () => {
  const usage = new TurnAccounting(vi.fn().mockResolvedValue(undefined))
  await usage.start(10000)
  await usage.reject()
  expect([usage.input, usage.output]).toEqual([0, 0])
  await usage.start(100)
  await usage.chunk({ type: "tool-input-delta", id: "tool", delta: "{}" })
  await usage.chunk({ type: "tool-call", toolCallId: "tool", input: {} })
  await usage.complete({})
  expect([usage.input, usage.output]).toEqual([100, 2])
})
