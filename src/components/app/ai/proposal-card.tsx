"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { applyAiProposalAction, dismissAiProposalAction } from "@/app/actions/ai"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LinkButton } from "@/components/app/link-button"
import { useAction } from "@/hooks/use-action"
import { can, type HouseholdRole } from "@/domain/permissions"
import { proposalChanges } from "@/domain/ai/description"
import type { ProposalItem } from "@/domain/ai/types"
import { formatMoney } from "@/lib/money"
import type { aiProposals } from "@/db/schema"

export type ProposalView = Pick<typeof aiProposals.$inferSelect, "id" | "title" | "status" | "items" | "messageId"> & { expired: boolean }
const MONEY_FIELDS = new Set([
  "amount",
  "targetAmount",
  "openingBalance",
  "creditLimit",
  "allocatedAmount",
  "toAmount",
  "minAmount",
  "maxAmount",
])
export function ProposalCard({
  proposal,
  role,
  names,
  onEdit,
}: {
  proposal: ProposalView
  role: HouseholdRole
  names: Record<string, string>
  onEdit: (text: string) => void
}) {
  const t = useTranslations("ai"),
    locale = useLocale()
  const { pending, run } = useAction()
  const [selected, setSelected] = useState(() => proposal.items.filter((i) => !i.result && can(role, i.permission)).map((i) => i.id))
  const open = !proposal.expired && ["pending", "partially_applied"].includes(proposal.status)
  function value(field: string, raw: unknown, item: ProposalItem) {
    if (raw === null || raw === undefined) return t("none")
    if (MONEY_FIELDS.has(field) && typeof raw === "number") return formatMoney(raw, item.currency, { locale })
    if (typeof raw === "boolean") return t(`values.${raw ? "yes" : "no"}`)
    if (typeof raw === "string") return names[raw] ?? (t.has(`values.${raw}`) ? t(`values.${raw}`) : raw)
    return String(raw)
  }
  return (
    <Card className="min-w-0 border-primary/20" data-testid="ai-proposal">
      <CardHeader>
        <CardTitle className="break-words text-base">{proposal.title}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {t(`status.${proposal.expired && ["pending", "partially_applied"].includes(proposal.status) ? "expired" : proposal.status}`)}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="divide-y">
          {proposal.items.map((item) => (
            <li key={item.id} className="space-y-2 py-3 first:pt-0">
              <label className="flex items-start gap-3">
                <Checkbox
                  className="mt-0.5"
                  aria-label={item.label || t(`kinds.${item.type.replaceAll(".", "_")}`)}
                  checked={item.result ? true : selected.includes(item.id)}
                  disabled={!open || Boolean(item.result) || !can(role, item.permission) || pending}
                  onCheckedChange={(checked) => setSelected((ids) => (checked ? [...ids, item.id] : ids.filter((id) => id !== item.id)))}
                />
                <span className="min-w-0 break-words text-sm font-medium">
                  {t(`kinds.${item.type.replaceAll(".", "_")}`)}
                  {item.label ? ` · ${item.label}` : ""}
                </span>
              </label>
              <dl className="space-y-1 pl-7 text-xs">
                {proposalChanges(item)
                  .filter(({ field }) => t.has(`fields.${field}`))
                  .map(({ field, before, after }) => (
                    <div key={field} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[8rem_1fr]">
                      <dt className="text-muted-foreground">{t(`fields.${field}`)}</dt>
                      <dd className="min-w-0 break-words">
                        {item.before ? (
                          <>
                            <span className="text-muted-foreground">{value(field, before, item)}</span>
                            <span aria-hidden> → </span>
                          </>
                        ) : null}
                        <span>{field === "amount" && after === null ? t("remove") : value(field, after, item)}</span>
                      </dd>
                    </div>
                  ))}
              </dl>
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
          ))}
        </ul>
        {open ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending || !selected.some((id) => proposal.items.some((i) => i.id === id && !i.result))}
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
              <Button variant="outline" disabled={pending} onClick={() => run(() => dismissAiProposalAction(proposal.id))}>
                {t("dismiss")}
              </Button>
              <Button variant="ghost" onClick={() => onEdit(t("editPrompt", { title: proposal.title }))}>
                {t("edit")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("expiredHint")}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
