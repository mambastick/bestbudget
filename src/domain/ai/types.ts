import type { Permission } from "@/domain/permissions"

export const PROVIDERS = ["openai", "openai_compatible", "anthropic", "google", "gigachat"] as const
export type AiProvider = (typeof PROVIDERS)[number] | "mock"
export type DataLevel = "aggregates" | "detailed"
export interface ProviderSnapshot {
  provider: AiProvider
  baseUrl: string
  model: string
  selfHosted: boolean
}
export interface ProposalItem {
  id: string
  type: string
  input: unknown
  before: Record<string, unknown> | null
  after: Record<string, unknown>
  permission: Permission
  label: string
  currency: string
  beforeCurrency?: string
  toCurrency?: string
  beforeToCurrency?: string
  fieldCurrencies?: Record<string, string>
  beforeFieldCurrencies?: Record<string, string>
  householdCurrency: string
  householdTimezone: string
  result?: { href: string; entityId?: string }
}
export const AI_MAX_STEPS = 8
export const AI_MAX_OUTPUT_TOKENS = 2048
export const AI_MAX_CONTEXT_BYTES = 64_000
export const AI_TURN_RESERVATION = AI_MAX_STEPS * (AI_MAX_CONTEXT_BYTES + AI_MAX_OUTPUT_TOKENS)
