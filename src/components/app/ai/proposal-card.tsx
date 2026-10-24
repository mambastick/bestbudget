"use client"

import { useState, useSyncExternalStore } from "react"
import { useLocale, useTranslations } from "next-intl"
import { applyAiProposalAction, dismissAiProposalAction } from "@/app/actions/ai"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LinkButton } from "@/components/app/link-button"
import { useAction } from "@/hooks/use-action"
import { can, type HouseholdRole } from "@/domain/permissions"
import { proposalChanges, proposalCurrency, PROPOSAL_MONEY_FIELDS as MONEY_FIELDS } from "@/domain/ai/description"
import { proposalSummary } from "@/domain/ai/summaries"
import type { ProposalItem } from "@/domain/ai/types"
import { formatMoney } from "@/lib/money"
import type { aiProposals } from "@/db/schema"

export type ProposalView = Pick<typeof aiProposals.$inferSelect, "id" | "title" | "status" | "items" | "messageId"> & { expired: boolean }
export function ProposalCard({
  proposal,
  role,
  names,
  onEdit,
  onDismiss,
  editLabel,
  canDismiss = true,
  interview = false,
}: {
  proposal: ProposalView
  role: HouseholdRole
  names: Record<string, string>
  onEdit: (text: string) => void
  onDismiss?: () => void
  editLabel?: string
  canDismiss?: boolean
  interview?: boolean
}) {
  const t = useTranslations("ai")
  const { pending, run } = useAction()
  const [selected, setSelected] = useState(() => proposal.items.filter((i) => !i.result && can(role, i.permission)).map((i) => i.id))
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const open =
    (!interview || can(role, "catalog.manage")) && !proposal.expired && ["pending", "partially_applied"].includes(proposal.status)
  return (
    <Card className="min-w-0 border-primary/20" data-testid="ai-proposal">
      <CardHeader>
        <CardTitle className="break-words text-base">{proposal.title}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t(`status.${proposal.expired && ["pending", "partially_applied"].includes(proposal.status) ? "expired" : proposal.status}`)}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {proposal.items.some((item) => item.dependsOn?.length) ? (
          <p className="text-xs text-muted-foreground">{t("interview.dependencies")}</p>
        ) : null}
        <ProposalItems
          items={proposal.items}
          role={role}
          names={names}
          selected={selected}
          setSelected={setSelected}
          open={open}
          pending={pending}
        />
        {interview && proposal.items.some((item) => item.result) ? (
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/calendar" variant="outline" size="sm">
              {t("interview.calendar")}
            </LinkButton>
            <LinkButton href="/budgets" variant="outline" size="sm">
              {t("interview.budgets")}
            </LinkButton>
          </div>
        ) : null}
        {open ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!hydrated || pending || !selected.some((id) => proposal.items.some((i) => i.id === id && !i.result))}
                onClick={() =>
                  run(
                    () =>
                      applyAiProposalAction(
                        proposal.id,
                        selected.filter((id) => !proposal.items.find((i) => i.id === id)?.result),
                      ),
                    { success: t("applied") },
                  )
                }
              >
                {t("apply")}
              </Button>
              <Button
                variant="outline"
                disabled={!hydrated || pending || !canDismiss}
                onClick={() => (onDismiss ? onDismiss() : run(() => dismissAiProposalAction(proposal.id)))}
              >
                {t("dismiss")}
              </Button>
              <Button variant="ghost" disabled={!hydrated || pending} onClick={() => onEdit(t("editPrompt", { title: proposal.title }))}>
                {editLabel ?? t("edit")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("expiredHint")}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

const subscribe = () => () => {}

export function ProposalItems({
  items,
  role,
  names,
  selected,
  setSelected,
  open,
  pending,
  staleItemIds = [],
  compact = false,
}: {
  items: ProposalItem[]
  role: HouseholdRole
  names: Record<string, string>
  selected: string[]
  setSelected: React.Dispatch<React.SetStateAction<string[]>>
  open: boolean
  pending: boolean
  staleItemIds?: string[]
  compact?: boolean
}) {
  const t = useTranslations("ai"),
    locale = useLocale()
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  function value(field: string, raw: unknown, item: ProposalItem, before = false) {
    if (raw === null || raw === undefined) return t("none")
    if (MONEY_FIELDS.has(field) && typeof raw === "number" && item.type === "import.rule" && !item.after.currency)
      return t("minorUnits", { value: new Intl.NumberFormat(locale).format(raw) })
    if (MONEY_FIELDS.has(field) && typeof raw === "number") return formatMoney(raw, proposalCurrency(item, field, before), { locale })
    if (typeof raw === "boolean") return t(`values.${raw ? "yes" : "no"}`)
    if (typeof raw === "string") return names[raw] ?? (t.has(`values.${raw}`) ? t(`values.${raw}`) : raw)
    return String(raw)
  }
  return (
    <ul className="divide-y">
      {items.map((item) => {
        const summary = proposalSummary(item, names, locale)
        return (
          <li key={item.id} className="space-y-2 py-3 first:pt-0">
            <label className="flex items-start gap-3">
              <Checkbox
                className="mt-0.5"
                aria-label={summary?.primary ?? (item.label || t(`kinds.${item.type.replaceAll(".", "_")}`))}
                checked={item.result ? true : !staleItemIds.includes(item.id) && selected.includes(item.id)}
                disabled={
                  !hydrated || !open || staleItemIds.includes(item.id) || Boolean(item.result) || !can(role, item.permission) || pending
                }
                onCheckedChange={(checked) =>
                  setSelected((ids) =>
                    checked
                      ? [...new Set([...ids, ...(item.dependsOn ?? []), item.id])]
                      : ids.filter((id) => id !== item.id && !items.find((candidate) => candidate.id === id)?.dependsOn?.includes(item.id)),
                  )
                }
              />
              <span className="min-w-0 break-words text-sm font-medium">
                {summary?.primary ?? (
                  <>
                    {t(`kinds.${item.type.replaceAll(".", "_")}`)}
                    {item.label ? ` · ${item.label}` : ""}
                  </>
                )}
              </span>
            </label>
            {summary ? (
              summary.secondary ? (
                <p className="break-words pl-7 text-xs text-muted-foreground" data-testid="ai-summary-details">
                  {summary.secondary}
                </p>
              ) : null
            ) : (
              <dl className={compact ? "flex flex-wrap gap-x-3 gap-y-1 pl-7 text-xs" : "space-y-1 pl-7 text-xs"}>
                {proposalChanges(item)
                  .filter(({ field }) => t.has(`fields.${field}`))
                  .map(({ field, before, after }) => (
                    <div key={field} className={compact ? "flex flex-wrap gap-x-1" : "grid grid-cols-1 gap-0.5 sm:grid-cols-[8rem_1fr]"}>
                      <dt className="text-muted-foreground">{t(`fields.${field}`)}</dt>
                      <dd className="min-w-0 break-words">
                        <span className="text-muted-foreground">{value(field, before, item, true)}</span>
                        <span aria-hidden> → </span>
                        <span>{field === "amount" && after === null ? t("remove") : value(field, after, item)}</span>
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
            {staleItemIds.includes(item.id) && !item.result ? (
              <p className="pl-7 text-xs text-amber-700 dark:text-amber-400" data-testid="ai-stale-item">
                {t(item.type === "budget.set" ? "review.staleBudget" : "review.staleItem", {
                  label: item.label || t(`kinds.${item.type.replaceAll(".", "_")}`),
                })}
              </p>
            ) : null}
            {!can(role, item.permission) ? <p className="pl-7 text-xs text-muted-foreground">{t("noPermission")}</p> : null}
            {item.result ? (
              <div className="flex items-center gap-2 pl-7 text-xs">
                <span>{t("applied")}</span>
                <LinkButton href={item.result.href} size="sm" variant="link">
                  {t("openEntity")}
                </LinkButton>
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
