import "server-only"
import { and, eq, sql } from "drizzle-orm"
import { getDb } from "@/db"
import { aiRecommendations, aiRecommendationProposals, aiReviewDecisions, aiReviews } from "@/db/schema"
import type { ProposalItem } from "@/domain/ai/types"
import type { HouseholdCtx } from "@/server/context"
import { AppError, notFound } from "@/server/errors"
import { todayIn } from "@/lib/dates"
import { fingerprint } from "./config"

/** Hashes stay on the server. Generated, untouched planned rows do not change the economic source. */
export async function reviewSourceFingerprint(ctx: HouseholdCtx) {
  const rows = await getDb().execute<{ hash: string }>(sql`select md5(jsonb_build_array(
    ${ctx.currency}::text, ${ctx.timezone}::text, ${todayIn(ctx.timezone)}::text,
    (select jsonb_agg(jsonb_build_array(id, version, archived_at) order by id) from financial_accounts where household_id = ${ctx.householdId}),
    (select jsonb_agg(jsonb_build_array(id, version) order by id) from categories where household_id = ${ctx.householdId}),
    (select jsonb_agg(jsonb_build_array(id, version) order by id) from category_budgets where household_id = ${ctx.householdId}),
    (select jsonb_agg(jsonb_build_array(id, version) order by id) from recurring_rules where household_id = ${ctx.householdId}),
    (select jsonb_agg(jsonb_build_array(id, version) order by id) from transactions where household_id = ${ctx.householdId}
      and not (status = 'planned' and version = 1 and (recurring_rule_id is not null or loan_id is not null))),
    (select jsonb_agg(jsonb_build_array(id, version) order by id) from goals where household_id = ${ctx.householdId}),
    (select jsonb_agg(jsonb_build_array(id, version) order by id) from category_rules where household_id = ${ctx.householdId}),
    (select jsonb_agg(id order by id) from goal_contributions where household_id = ${ctx.householdId}),
    (select jsonb_agg(jsonb_build_array(id, version) order by id) from loans where household_id = ${ctx.householdId}),
    (select jsonb_agg(id order by id) from loan_events where household_id = ${ctx.householdId}),
    (select jsonb_agg(jsonb_build_array(currency, date, source, rate_to_rub) order by currency, date, source) from exchange_rates
      where currency in (select currency from financial_accounts where household_id = ${ctx.householdId})
         or currency in (select currency from goals where household_id = ${ctx.householdId}) or currency = ${ctx.currency})
  )::text) as hash`)
  return rows[0]!.hash
}

/** Numeric magnitudes, wording, locale and proposal grouping cannot evade a rejection. */
export function reviewItemFingerprint(item: ProposalItem) {
  const input = item.input as Record<string, unknown>
  const target =
    input.id ??
    (item.type === "budget.set"
      ? input.categoryId
      : item.operation === "create"
        ? {
            name: String(input.name ?? input.title ?? item.label)
              .trim()
              .toLowerCase(),
            accountId: input.accountId,
            toAccountId: input.toAccountId,
            categoryId: input.categoryId,
          kind: input.kind,
          currency: input.currency,
          descriptionMode: input.descriptionMode,
            descriptionPattern: input.descriptionPattern,
            mcc: input.mcc,
          }
        : (input.categoryId ?? input.accountId ?? item.label.trim().toLowerCase()))
  const directions = Object.keys(item.after)
    .filter((field) => field !== "version")
    .sort()
    .flatMap((field) => {
      const after = item.after[field],
        before = item.before?.[field]
      if (typeof after === "number" && (typeof before === "number" || before == null))
        return [`${field}:${after > (before ?? 0) ? "increase" : after < (before ?? 0) ? "decrease" : "same"}`]
      return []
    })
  return fingerprint({ type: item.type, target, direction: directions.length ? directions : item.type.split(".")[1] })
}

export async function rejectedFingerprints(ctx: HouseholdCtx) {
  return new Set(
    (
      await getDb()
        .select({ fingerprint: aiReviewDecisions.fingerprint })
        .from(aiReviewDecisions)
        .where(eq(aiReviewDecisions.householdId, ctx.householdId))
    ).map((r) => r.fingerprint),
  )
}

export async function reviewForProposal(ctx: HouseholdCtx, proposalId: string, lock = false) {
  const query = getDb()
    .select({ recommendation: aiRecommendations, review: aiReviews })
    .from(aiRecommendationProposals)
    .innerJoin(
      aiRecommendations,
      and(
        eq(aiRecommendations.id, aiRecommendationProposals.recommendationId),
        eq(aiRecommendations.householdId, aiRecommendationProposals.householdId),
      ),
    )
    .innerJoin(
      aiReviews,
      and(eq(aiReviews.id, aiRecommendations.reviewId), eq(aiReviews.householdId, aiRecommendations.householdId)),
    )
    .where(and(eq(aiRecommendationProposals.householdId, ctx.householdId), eq(aiRecommendationProposals.proposalId, proposalId)))
  const [row] = await (lock ? query.for("update", { of: aiRecommendations }) : query)
  return row
}

export async function assertReviewProposalCurrent(ctx: HouseholdCtx, proposalId: string, alreadyApplied: boolean) {
  const row = await reviewForProposal(ctx, proposalId, true)
  if (!row || row.review.status !== "completed") throw notFound()
  if (alreadyApplied) return
  if (row.recommendation.status === "dismissed") throw new AppError("ai.proposalClosed")
  if (
    row.recommendation.status === "expired" ||
    row.recommendation.expiresAt <= new Date() ||
    row.review.sourceFingerprint !== (await reviewSourceFingerprint(ctx))
  )
    throw new AppError("ai.expired")
}
