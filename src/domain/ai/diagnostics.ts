export type AiErrorCode =
  | "ai.keyRejected"
  | "ai.noCredits"
  | "ai.modelNotFound"
  | "ai.noTools"
  | "ai.rateLimited"
  | "ai.unavailable"
  | "ai.networkError"
  | "ai.connectionFailed"

export interface AiDiagnostic {
  code: AiErrorCode
  status: number | null
  message: string
}
