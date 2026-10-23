import "server-only"
import { AsyncLocalStorage } from "node:async_hooks"
import { getDb, type DbOrTx } from "@/db"
import { auditLogs } from "@/db/schema"

const auditScope = new AsyncLocalStorage<{ source: "ai"; proposalId: string }>()

export function withAiAudit<T>(proposalId: string, fn: () => Promise<T>) {
  return auditScope.run({ source: "ai", proposalId }, fn)
}

export interface AuditEntry {
  action: string
  entityType: string
  entityId?: string | null
  householdId?: string | null
  actorId?: string | null
  meta?: Record<string, unknown>
}

/** Records an audit event. Callers must never put secrets into `meta`. */
export async function audit(entry: AuditEntry, db: DbOrTx = getDb()) {
  await db.insert(auditLogs).values({
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    householdId: entry.householdId ?? null,
    actorId: entry.actorId ?? null,
    meta: auditScope.getStore() ? { ...entry.meta, ...auditScope.getStore() } : entry.meta ?? null,
  })
}

/** Field-level diff for audit logs. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of Object.keys(after)) {
    if (after[key] !== undefined && before[key] !== after[key]) out[key] = { from: before[key], to: after[key] }
  }
  return out
}
