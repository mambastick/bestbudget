import "server-only"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { aiHouseholdSettings } from "@/db/schema"
import { audit } from "@/server/audit"
import { assertCan, type HouseholdCtx } from "@/server/context"
import { AppError, forbidden } from "@/server/errors"
import { resolveHouseholdCtx } from "@/server/services/households"
import { fingerprint, getAiConfig, snapshot, type AiConfig } from "./config"

export async function householdAiView(ctx: HouseholdCtx, configOverride?: AiConfig | null) {
  const config = configOverride === undefined ? await getAiConfig() : configOverride
  const [settings] = await getDb().select().from(aiHouseholdSettings).where(eq(aiHouseholdSettings.householdId, ctx.householdId))
  const provider = config ? snapshot(config) : null
  const available = Boolean(config?.enabled && config.ready)
  const consentCurrent = Boolean(provider && settings?.consentAt && fingerprint(settings.providerSnapshot) === fingerprint(provider))
  return {
    available,
    enabled: Boolean(available && settings?.enabled && consentCurrent),
    provider,
    dataLevel: settings?.dataLevel ?? "aggregates",
    version: settings?.version ?? 0,
    consentCurrent,
  }
}
export async function requireAi(ctx: HouseholdCtx) {
  const fresh = await resolveHouseholdCtx(ctx.userId, ctx.householdId)
  if (!fresh) throw forbidden()
  assertCan(fresh, "finance.read")
  const config = await getAiConfig()
  const view = await householdAiView(fresh, config)
  if (!view.enabled) throw new AppError("ai.disabled", {}, "not_found")
  return { ctx: { ...fresh, locale: ctx.locale }, view, config: config! }
}
export const consentInput = z.object({
  enabled: z.boolean(),
  dataLevel: z.enum(["aggregates", "detailed"]),
  consent: z.boolean(),
  providerFingerprint: z.string(),
  version: z.number().int().nonnegative(),
})
export async function saveHouseholdAi(ctx: HouseholdCtx, raw: z.input<typeof consentInput>) {
  assertCan(ctx, "household.manage")
  const input = consentInput.parse(raw)
  const view = await householdAiView(ctx)
  if (input.enabled && (!view.available || !input.consent || input.providerFingerprint !== fingerprint(view.provider)))
    throw new AppError("ai.consentRequired")
  return getDb().transaction(async (db) => {
    // The settings row serializes consent changes; a conditional update detects stale forms.
    await db.insert(aiHouseholdSettings).values({ householdId: ctx.householdId }).onConflictDoNothing()
    const [before] = await db.select().from(aiHouseholdSettings).where(eq(aiHouseholdSettings.householdId, ctx.householdId)).for("update")
    if (before!.version !== (input.version || 1)) throw new AppError("conflict", {}, "conflict")
    await db
      .update(aiHouseholdSettings)
      .set({
        enabled: input.enabled,
        dataLevel: input.dataLevel,
        providerSnapshot: view.provider,
        consentBy: input.enabled ? ctx.userId : before!.consentBy,
        consentAt: input.enabled ? new Date() : before!.consentAt,
        version: before!.version + 1,
      })
      .where(and(eq(aiHouseholdSettings.householdId, ctx.householdId), eq(aiHouseholdSettings.version, before!.version)))
    await audit(
      {
        action: "ai.consent",
        entityType: "ai_settings",
        householdId: ctx.householdId,
        actorId: ctx.userId,
        meta: { enabled: input.enabled, dataLevel: input.dataLevel },
      },
      db,
    )
  })
}
