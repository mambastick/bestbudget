import "server-only"
import { and, eq, gt, ne } from "drizzle-orm"
import { createTranslator } from "use-intl/core"
import { getDb } from "@/db"
import { aiConversations, aiRecommendations, aiReviews, aiReviewSettings, notificationPreferences, users } from "@/db/schema"
import { dueReview, reviewSettingsInput } from "@/domain/ai/review"
import { isQuiet, localClock } from "@/domain/notifications"
import { recipientLocale } from "@/i18n/locale"
import { appUrl } from "@/lib/env"
import { sendMail, smtpEnabled } from "@/lib/mail"
import { fingerprint } from "@/server/ai/config"
import { requireAi } from "@/server/ai/access"
import { recoverInterruptedReviews, reviewOwner, runBudgetReview } from "@/server/ai/reviews"
import { deliverOnce } from "@/server/notifications/delivery"
import { resolveHouseholdCtx } from "@/server/services/households"
import { buildTargets, loadTelegramConfig, stillAllowed } from "./notifications"
import en from "../../../messages/en/ai.json"
import ru from "../../../messages/ru/ai.json"

/** Scheduler advisory lock plus committed unique period claims protect multiple replicas and restarts. */
export async function runBudgetReviewJob(now = new Date(), signal?: AbortSignal) {
  await recoverInterruptedReviews(now)
  const settings = await getDb().select().from(aiReviewSettings).where(ne(aiReviewSettings.frequency, "off"))
  for (const row of settings) {
    if (signal?.aborted) return
    try {
      const ctx = await reviewOwner(row.householdId)
      if (!ctx) continue
      const key = dueReview(reviewSettingsInput.parse(row), ctx.timezone, now)
      if (!key) continue
      await runBudgetReview(ctx, { periodKey: key, signal })
    } catch {
      // Disabled consent/providers and per-household failures must not expose financial details.
    }
  }
}

/** Recomputed during quiet hours; deliverOnce persists a per-review, recipient and channel claim. */
export async function deliverReviewNotifications(now = new Date()) {
  const telegram = await loadTelegramConfig()
  const recipients = await getDb()
    .select({ p: notificationPreferences, user: users })
    .from(notificationPreferences)
    .innerJoin(users, eq(users.id, notificationPreferences.userId))
    .where(and(eq(notificationPreferences.aiReview, true), eq(users.banned, false)))
  for (const { p, user } of recipients) {
    try {
      const ctx = await resolveHouseholdCtx(p.userId, p.householdId)
      if (!ctx) continue
      const access = await requireAi(ctx)
      const locale = recipientLocale(user)
      if (isQuiet(localClock(ctx.timezone, now, locale), p.quietStart, p.quietEnd)) continue
      const [settings] = await getDb().select().from(aiReviewSettings).where(eq(aiReviewSettings.householdId, p.householdId))
      if (!settings) continue
      const targets = await buildTargets(
        { ...p, telegram: p.telegram && settings.telegram, push: p.push && settings.push },
        telegram,
        locale,
      )
      if (settings.email && p.reviewEmail && smtpEnabled())
        targets.push({
          channel: "email",
          suffix: "",
          send: async (notice) => {
            await sendMail({ to: user.email, subject: notice.text, text: `${notice.text}\n${appUrl()}${notice.path}` })
          },
        })
      if (!targets.length) continue
      const pending = await getDb()
        .select({ reviewId: aiReviews.id, recommendationId: aiRecommendations.id })
        .from(aiReviews)
        .innerJoin(
          aiRecommendations,
          and(eq(aiRecommendations.householdId, aiReviews.householdId), eq(aiRecommendations.reviewId, aiReviews.id)),
        )
        .innerJoin(
          aiConversations,
          and(eq(aiConversations.householdId, aiReviews.householdId), eq(aiConversations.id, aiReviews.conversationId)),
        )
        .where(
          and(
            eq(aiConversations.dataLevel, access.view.dataLevel),
            eq(aiConversations.consentFingerprint, fingerprint(access.view.provider)),
            eq(aiReviews.householdId, p.householdId),
            eq(aiReviews.status, "completed"),
            eq(aiRecommendations.status, "pending"),
            gt(aiRecommendations.expiresAt, now),
          ),
        )
      const counts = new Map<string, number>()
      for (const r of pending) counts.set(r.reviewId, (counts.get(r.reviewId) ?? 0) + 1)
      const t = createTranslator({ locale, messages: locale === "ru" ? ru : en })
      for (const [reviewId, count] of counts) {
        const notice = {
          kind: "ai_review",
          key: `ai-review:${reviewId}`,
          text: t("review.notification", { count }),
          path: `/api/notifications/open?household=${p.householdId}&page=${encodeURIComponent("/assistant/recommendations")}`,
        }
        for (const target of targets) {
          if (!(await stillAllowed(p))) break
          const current = await requireAi(ctx)
          const [currentSettings] = await getDb()
            .select()
            .from(aiReviewSettings)
            .where(eq(aiReviewSettings.householdId, p.householdId))
          if (
            currentSettings?.version !== settings.version ||
            current.view.dataLevel !== access.view.dataLevel ||
            fingerprint(current.view.provider) !== fingerprint(access.view.provider)
          )
            break
          await deliverOnce(
            { userId: p.userId, householdId: p.householdId, channel: target.channel, notice, suffix: target.suffix },
            () => target.send(notice),
            now,
          )
        }
      }
    } catch {
      // Errors and notification bodies are private, consistent with the financial reminder job.
    }
  }
}
