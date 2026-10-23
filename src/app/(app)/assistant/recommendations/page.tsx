import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { AiRecommendations } from "@/components/app/ai/recommendations"
import { NavTabs } from "@/components/app/nav-tabs"
import { householdAiView } from "@/server/ai/access"
import { latestReview, listRecommendations } from "@/server/ai/reviews"
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
  const [rows, latest, accounts, categories] = await Promise.all([
    listRecommendations(ctx),
    latestReview(ctx),
    listAccounts(ctx),
    listCategories(ctx),
  ])
  return (
    <div className="grid min-w-0 grid-cols-1 gap-5 pb-8">
      <div className="min-w-0 px-1 sm:px-0">
        <NavTabs
          active="recommendations"
          tabs={[
            { key: "chat", label: t("review.chatTab"), href: "/assistant" },
            { key: "recommendations", label: t("review.title"), href: "/assistant/recommendations" },
          ]}
        />
      </div>
      <AiRecommendations
        rows={rows}
        latest={latest}
        role={ctx.role}
        timezone={ctx.timezone}
        names={Object.fromEntries([...accounts, ...categories].map((r) => [r.id, r.name]))}
      />
    </div>
  )
}
