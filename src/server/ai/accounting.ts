import { AI_MAX_OUTPUT_TOKENS } from "@/domain/ai/types"

/** Byte-based upper estimates apply only to the current dispatched step and received output. */
export class TurnAccounting {
  private completedInput = 0
  private completedOutput = 0
  private pendingInput = 0
  private pendingOutput = 0
  private toolDeltas = new Set<string>()
  constructor(private checkpoint: (input: number, output: number) => Promise<void>) {}
  get input() {
    return this.completedInput + this.pendingInput
  }
  get output() {
    return this.completedOutput + this.pendingOutput
  }
  async start(bytes: number) {
    this.pendingInput = bytes
    this.pendingOutput = 0
    this.toolDeltas.clear()
    await this.save()
  }
  async chunk(chunk: { type: string; text?: string; delta?: string; id?: string; toolCallId?: string; input?: unknown }) {
    let bytes = 0
    if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") bytes = Buffer.byteLength(chunk.text ?? "")
    if (chunk.type === "tool-input-delta") {
      this.toolDeltas.add(chunk.id!)
      bytes = Buffer.byteLength(chunk.delta ?? "")
    }
    if (chunk.type === "tool-call" && !this.toolDeltas.has(chunk.toolCallId!)) bytes = Buffer.byteLength(JSON.stringify(chunk.input) ?? "")
    if (!bytes) return
    this.pendingOutput = Math.min(AI_MAX_OUTPUT_TOKENS, this.pendingOutput + bytes)
    await this.save()
  }
  async complete(usage: { inputTokens?: number; outputTokens?: number }) {
    this.completedInput += usage.inputTokens ?? this.pendingInput
    this.completedOutput += usage.outputTokens ?? this.pendingOutput
    this.pendingInput = this.pendingOutput = 0
    await this.save()
  }
  async reject() {
    // An error before any model output (HTTP rejection/connect failure) did not complete a generation.
    if (!this.pendingOutput) this.pendingInput = 0
    await this.save()
  }
  private save() {
    return this.checkpoint(this.input, this.output)
  }
}
