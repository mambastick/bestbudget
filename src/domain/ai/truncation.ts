import type { UIMessage } from "ai"

export type TruncationReason = "length" | "timeout"

const PART_TYPE = "data-truncated"

/** Data parts are stored with the message but never sent back to the model. */
export function markTruncated(message: UIMessage, reason: TruncationReason): UIMessage {
  return { ...message, parts: [...message.parts, { type: PART_TYPE, data: { reason } }] }
}

export function truncationReason(message: UIMessage): TruncationReason | null {
  const part = message.parts.find((candidate) => candidate.type === PART_TYPE)
  return part && "data" in part ? (part.data as { reason: TruncationReason }).reason : null
}
