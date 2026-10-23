import { getTranslations } from "next-intl/server"
import { LinkButton } from "@/components/app/link-button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { HouseholdCtx } from "@/server/context"
import { recommendationSummary } from "@/server/ai/reviews"

export async function AiReviewWidget({ ctx }: { ctx: HouseholdCtx }) {
  const [summary, t] = await Promise.all([recommendationSummary(ctx), getTranslations("ai.review")])
  return (
    <Card data-testid="ai-review-widget" className="min-w-0">
      <CardHeader>
        <CardTitle>{t("widgetTitle", { count: summary.count })}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        {summary.items.length ? (
          <ul className="space-y-2 text-sm">
            {summary.items.map((r) => (
              <li className="break-words" key={r.id}>
                {r.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("widgetEmpty")}</p>
        )}
        <LinkButton className="justify-self-start" variant="outline" href="/assistant/recommendations">
          {t("open")}
        </LinkButton>
      </CardContent>
    </Card>
  )
}
