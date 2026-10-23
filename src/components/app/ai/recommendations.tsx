"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, ArrowUp, Info, Sparkles } from "lucide-react"
import {
  applyAiRecommendationAction,
  dismissAiRecommendationAction,
  discussAiRecommendationAction,
  runAiReviewAction,
} from "@/app/actions/ai-review"
import { HydratedControls } from "@/components/app/hydrated-controls"
import { LinkButton } from "@/components/app/link-button"
import { EmptyState } from "@/components/app/empty-state"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { can, type HouseholdRole } from "@/domain/permissions"
import { REVIEW_MANUAL_LIMIT } from "@/domain/ai/review"
import { useAction } from "@/hooks/use-action"
import { formatDateTime } from "@/lib/dates"
import type { latestReview, listRecommendations } from "@/server/ai/reviews"
import { ProposalItems } from "./proposal-card"

type Recommendation = Awaited<ReturnType<typeof listRecommendations>>[number]
function RecommendationCard({ row, role, names }: { row: Recommendation; role: HouseholdRole; names: Record<string, string> }) {
  const t = useTranslations("ai"),
    router = useRouter()
  const { run, pending } = useAction()
  const items = row.proposals.flatMap((p) => p.items)
  const staleItemIds = row.proposals.flatMap((p) => p.staleItemIds)
  const [selected, setSelected] = useState(() =>
    items.filter((i) => !i.result && !staleItemIds.includes(i.id) && can(role, i.permission)).map((i) => i.id),
  )
  const choices = row.proposals
    .map((p) => ({
      proposalId: p.id,
      itemIds: p.items
        .filter((i) => selected.includes(i.id) && !i.result && !staleItemIds.includes(i.id) && can(role, i.permission))
        .map((i) => i.id),
    }))
    .filter((p) => p.itemIds.length)
  const mayDismiss = items.length ? items.every((i) => i.result || can(role, i.permission)) : can(role, "catalog.manage")
  const ImportanceIcon = row.insight.importance === "high" ? AlertTriangle : row.insight.importance === "medium" ? ArrowUp : Info
  return (
    <Card className="min-w-0" data-testid="ai-recommendation" data-status={row.status}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge
            variant={row.insight.importance === "high" ? "destructive" : "secondary"}
            className={
              row.insight.importance === "medium"
                ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                : row.insight.importance === "low"
                  ? "bg-blue-500/15 text-blue-800 dark:text-blue-300"
                  : undefined
            }
          >
            <ImportanceIcon />
            {t(`review.importance.${row.insight.importance}`)}
          </Badge>
          <Badge variant="outline">{t(`review.status.${row.status}`)}</Badge>
          <span>{t("review.author")}</span>
        </div>
        <CardTitle className="break-words text-lg">{row.insight.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid min-w-0 grid-cols-1 gap-4">
        <p className="break-words text-sm leading-relaxed">{row.insight.explanation}</p>
        {row.insight.type === "loan" ? (
          <LinkButton variant="link" className="justify-self-start" href={`/loans/${row.insight.entityId}`}>
            {t("review.openLoan")}
          </LinkButton>
        ) : null}
        {row.status === "expired" ? <p className="text-xs text-muted-foreground">{t("review.expiredHint")}</p> : null}
        {items.length ? (
          <ProposalItems
            items={items}
            role={role}
            names={names}
            selected={selected}
            setSelected={setSelected}
            open={row.status === "pending"}
            pending={pending}
            staleItemIds={staleItemIds}
            compact
          />
        ) : null}
        <div className="flex flex-wrap gap-2">
          {row.status === "pending" && items.length ? (
            <Button
              disabled={pending || !choices.length}
              onClick={() => run(() => applyAiRecommendationAction(row.id, choices), { success: t("applied") })}
            >
              {t("apply")}
            </Button>
          ) : null}
          {["pending", "expired"].includes(row.status) ? (
            <Button variant="outline" disabled={pending || !mayDismiss} onClick={() => run(() => dismissAiRecommendationAction(row.id))}>
              {t("dismiss")}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              run(() => discussAiRecommendationAction(row.id), { onSuccess: (data) => router.push(`/assistant?id=${data.id}`) })
            }
          >
            {t("review.discuss")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function AiRecommendations({
  rows,
  latest,
  role,
  timezone,
  names,
}: {
  rows: Recommendation[]
  latest: Awaited<ReturnType<typeof latestReview>>
  role: HouseholdRole
  timezone: string
  names: Record<string, string>
}) {
  const t = useTranslations("ai.review"),
    locale = useLocale()
  const { run, pending } = useAction()
  const active = rows.filter((r) => r.status === "pending"),
    history = rows.filter((r) => r.status !== "pending")
  const mayRun = can(role, "catalog.manage")
  const runReview = (
    <Button disabled={pending || latest?.status === "running"} onClick={() => run(runAiReviewAction)}>
      <Sparkles />
      {pending ? t("running") : t("runNow")}
    </Button>
  )
  return (
    <HydratedControls loadingLabel={t("loading")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <SidebarTrigger className="md:hidden" />
          <div>
            <h1 className="text-2xl font-semibold">{t("title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("hint")}</p>
          </div>
        </div>
        {mayRun ? runReview : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("manualLimit", { count: REVIEW_MANUAL_LIMIT })}</p>
      {latest ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("lastRun", { date: formatDateTime(latest.at, timezone, locale), status: t(`runStatus.${latest.status}`) })}
        </p>
      ) : null}
      {active.some((r) => r.sourceChanged) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted p-3 text-sm" data-testid="ai-review-changed">
          <Info className="size-4 shrink-0" />
          <span>{t("dataChanged")}</span>
          {mayRun ? (
            <Button
              variant="link"
              className="h-auto p-0"
              disabled={pending || latest?.status === "running"}
              onClick={() => run(runAiReviewAction)}
            >
              {t("runAgain")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {!active.length ? (
        <EmptyState icon={Sparkles} title={t("empty")} description={t("emptyHint")} />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {active.map((row) => (
            <RecommendationCard key={row.id} row={row} role={role} names={names} />
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("lifetimeHint")}</p>
      {history.length ? (
        <details className="grid min-w-0 grid-cols-1 gap-4">
          <summary className="mb-4 cursor-pointer text-sm text-muted-foreground">{t("history", { count: history.length })}</summary>
          <div className="grid grid-cols-1 gap-4">
            {history.map((row) => (
              <RecommendationCard key={row.id} row={row} role={role} names={names} />
            ))}
          </div>
        </details>
      ) : null}
      <LinkButton href="/settings?tab=household#ai-review-settings" variant="link" className="justify-self-start">
        {t("settingsLink")}
      </LinkButton>
    </HydratedControls>
  )
}
