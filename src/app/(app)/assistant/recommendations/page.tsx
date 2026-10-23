import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { AiRecommendations } from "@/components/app/ai/recommendations"
import { AiReviewSettings } from "@/components/app/ai/review-settings"
import { NavTabs } from "@/components/app/nav-tabs"
import { can } from "@/domain/permissions"
import { householdAiView } from "@/server/ai/access"
import { getReviewSettings, latestReview, listRecommendations } from "@/server/ai/reviews"
import { requireHousehold } from "@/server/session"
import { listAccounts, listCategories } from "@/server/services/catalog"

export async function generateMetadata() {
  return { title: (await getTranslations("ai.review"))("title") }
}
export default async function RecommendationsPage() {
  const ctx = await requireHousehold(),
    view = await householdAiView(ctx),
    t = await getTranslations("ai")
  if (!view.enabled) notFound()
  const [rows, latest, settings, accounts, categories] = await Promise.all([
    listRecommendations(ctx),
    latestReview(ctx),
    getReviewSettings(ctx),
    listAccounts(ctx),
    listCategories(ctx),
  ])
  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 pb-8">
      <NavTabs
        active="recommendations"
        tabs={[
          { key: "chat", label: t("review.chatTab"), href: "/assistant" },
          { key: "recommendations", label: t("review.title"), href: "/assistant/recommendations" },
        ]}
      />
      <AiRecommendations
        rows={rows}
        latest={latest}
        role={ctx.role}
        timezone={ctx.timezone}
        names={Object.fromEntries([...accounts, ...categories].map((r) => [r.id, r.name]))}
      />
      <AiReviewSettings
        key={settings.version}
        settings={settings}
        enabled={view.enabled}
        canManage={can(ctx.role, "catalog.manage")}
        timezone={ctx.timezone}
      />
    </div>
  )
}
