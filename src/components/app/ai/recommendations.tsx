"use client"

import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Sparkles } from "lucide-react"
import { dismissAiRecommendationAction, discussAiRecommendationAction, runAiReviewAction } from "@/app/actions/ai-review"
import { HydratedControls } from "@/components/app/hydrated-controls"
import { LinkButton } from "@/components/app/link-button"
import { EmptyState } from "@/components/app/empty-state"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { can, type HouseholdRole } from "@/domain/permissions"
import { REVIEW_MANUAL_LIMIT } from "@/domain/ai/review"
import { useAction } from "@/hooks/use-action"
import { formatDateTime } from "@/lib/dates"
import type { latestReview, listRecommendations } from "@/server/ai/reviews"
import { ProposalCard } from "./proposal-card"

export function AiRecommendations({
  rows,
  latest,
  role,
  timezone,
  names,
}: {
  rows: Awaited<ReturnType<typeof listRecommendations>>
  latest: Awaited<ReturnType<typeof latestReview>>
  role: HouseholdRole
  timezone: string
  names: Record<string, string>
}) {
  const t = useTranslations("ai.review"),
    locale = useLocale(),
    router = useRouter()
  const { run, pending } = useAction()
  const active = rows.filter((r) => r.status === "pending"),
    history = rows.filter((r) => r.status !== "pending")
  function discuss(id: string) {
    run(() => discussAiRecommendationAction(id), { onSuccess: (data) => router.push(`/assistant?id=${data.id}`) })
  }
  function renderRow(row: (typeof rows)[number]) {
    const mayDismiss = row.proposals.length
      ? row.proposals.every((p) => p.items.every((i) => i.result || can(role, i.permission)))
      : can(role, "catalog.manage")
    return (
      <Card key={row.id} className="min-w-0" data-testid="ai-recommendation" data-status={row.status}>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{t("author")}</span>
            <span className={row.insight.importance === "high" ? "font-medium text-destructive" : ""}>
              {t(`importance.${row.insight.importance}`)}
            </span>
            <span>{t(`status.${row.status}`)}</span>
          </div>
          <CardTitle className="break-words text-lg">{row.insight.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid min-w-0 grid-cols-1 gap-4">
          <p className="break-words text-sm leading-relaxed">{row.insight.explanation}</p>
          {row.insight.type === "loan" ? (
            <LinkButton variant="link" className="justify-self-start" href={`/loans/${row.insight.entityId}`}>
              {t("openLoan")}
            </LinkButton>
          ) : null}
          {row.status === "expired" ? <p className="text-xs text-muted-foreground">{t("expiredHint")}</p> : null}
          {row.proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              role={role}
              names={names}
              onEdit={() => discuss(row.id)}
              onDismiss={() => run(() => dismissAiRecommendationAction(row.id))}
              editLabel={t("discuss")}
              canDismiss={mayDismiss}
            />
          ))}
          <div className="flex flex-wrap gap-2">
            {!row.proposals.length && row.status === "pending" ? (
              <Button
                variant="outline"
                disabled={pending || !mayDismiss}
                onClick={() => run(() => dismissAiRecommendationAction(row.id))}
              >
                {t("dismiss")}
              </Button>
            ) : null}
            {row.status === "expired" && mayDismiss ? (
              <Button variant="outline" disabled={pending} onClick={() => run(() => dismissAiRecommendationAction(row.id))}>
                {t("dismiss")}
              </Button>
            ) : null}
            {!row.proposals.length || row.status !== "pending" ? (
              <Button variant="ghost" disabled={pending} onClick={() => discuss(row.id)}>
                {t("discuss")}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    )
  }
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
        {can(role, "catalog.manage") ? (
          <Button disabled={pending || latest?.status === "running"} onClick={() => run(runAiReviewAction)}>
            <Sparkles />
            {pending ? t("running") : t("runNow")}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{t("manualLimit", { count: REVIEW_MANUAL_LIMIT })}</p>
      {latest ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("lastRun", { date: formatDateTime(latest.at, timezone, locale), status: t(`runStatus.${latest.status}`) })}
        </p>
      ) : null}
      {!active.length ? (
        <EmptyState icon={Sparkles} title={t("empty")} description={t("emptyHint")} />
      ) : (
        <div className="grid grid-cols-1 gap-4">{active.map(renderRow)}</div>
      )}
      {history.length ? (
        <details className="grid min-w-0 grid-cols-1 gap-4">
          <summary className="mb-4 cursor-pointer text-sm text-muted-foreground">
            {t("history", { count: history.length })}
          </summary>
          <div className="grid grid-cols-1 gap-4">{history.map(renderRow)}</div>
        </details>
      ) : null}
    </HydratedControls>
  )
}
