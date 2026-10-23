"use client"

import { useTranslations, useLocale } from "next-intl"

import { useState } from "react"
import {
  automateGoalAction,
  contributeToGoalAction,
  setGoalArchivedAction,
  stopGoalAutomationAction,
  transferToGoalAction,
} from "@/app/actions/goals"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { DateField } from "@/components/app/date-field"
import { LinkButton } from "@/components/app/link-button"
import { MoneyInput } from "@/components/app/money-input"
import { Segmented } from "@/components/app/segmented"
import { Section } from "@/components/app/settings/section"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAction } from "@/hooks/use-action"
import { automaticGoalSchedule } from "@/domain/goals"
import { formatDateFull } from "@/lib/dates"
import { formatMoney, parseMoney } from "@/lib/money"
import type { getGoalDetail, GoalSummary } from "@/server/services/goals"
import { GoalCard } from "./goal-card"
import { GoalChart } from "./goal-chart"
import { AccountSelect, GoalEditor, type GoalAccount } from "./goal-editor"

export function GoalDetail({
  detail: d,
  accounts,
  canWrite,
}: {
  detail: Awaited<ReturnType<typeof getGoalDetail>>
  accounts: GoalAccount[]
  canWrite: boolean
}) {
  const t = useTranslations("goals")
  const locale = useLocale()
  const g = d.goal
  const [mode, setMode] = useState<"edit" | "contribute" | "auto" | null>(null)
  const { run, pending } = useAction()
  const active = g.status !== "archived"
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <GoalCard goal={g} />
        <div className="grid grid-cols-1 gap-3 rounded-xl border p-5 text-sm">
          <p>
            {t.rich("detail.remaining", {
              amount: g.target === null || g.progress === null ? t("card.rateRequired") : formatMoney(g.remaining, g.currency, { locale }),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <p>
            {t.rich("detail.pace", {
              amount: formatMoney(g.monthlyPace, g.currency, { locale }),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <p>
            {t.rich("detail.historicalDate", {
              date: g.historicalDate ? formatDateFull(g.historicalDate, locale) : t("detail.noDate"),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          {d.hasPlan ? (
            <p>
              {t.rich("detail.plannedDate", {
                date: g.plannedDate ? formatDateFull(g.plannedDate, locale) : t("detail.beyondHorizon"),
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          ) : null}
          {g.kind === "account" ? <p className="text-xs text-muted-foreground">{t("detail.allocationHint")}</p> : null}
          {active && g.kind === "account" && g.fundingGap === null && g.progress !== null ? (
            <p className="text-xs text-muted-foreground">{t("detail.automationHint")}</p>
          ) : null}
          {g.expenseMonths ? (
            <p className="text-xs text-muted-foreground">
              {t("detail.emergency", { count: g.expenseMonths, window: g.expenseWindow })} {g.target === 0 ? t("detail.addExpenses") : ""}
            </p>
          ) : null}
        </div>
      </div>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          {active ? (
            <>
              <Button onClick={() => setMode("contribute")}>{t("detail.contribute")}</Button>
              <Button variant="outline" onClick={() => setMode("edit")}>
                {t("actions.edit")}
              </Button>
              {g.kind === "account" && !g.automation ? (
                <Button
                  variant="outline"
                  onClick={() => setMode("auto")}
                  disabled={!g.targetDate || !g.monthlyRequired || g.progress === null || g.fundingGap === null}
                >
                  {t("detail.automate")}
                </Button>
              ) : null}
              {g.automation ? (
                <>
                  <LinkButton variant="outline" href="/transactions?tab=rules">
                    {t("detail.recurring")}
                  </LinkButton>
                  <ConfirmDialog
                    title={t("automation.stopTitle")}
                    description={t("automation.stopDescription")}
                    confirmLabel={t("automation.stopConfirm")}
                    destructive={false}
                    trigger={
                      <Button variant="outline" disabled={pending}>
                        {t("automation.stop")}
                      </Button>
                    }
                    onConfirm={() => run(() => stopGoalAutomationAction(g.id), { success: t("automation.stopped") })}
                  />
                </>
              ) : null}
            </>
          ) : null}
          <ConfirmDialog
            title={active ? t("archive.title") : t("archive.restoreTitle")}
            description={active ? t("archive.description") : t("archive.restoreDescription")}
            confirmLabel={active ? t("actions.archive") : t("actions.restore")}
            destructive={false}
            trigger={
              <Button variant="outline" disabled={pending}>
                {active ? t("actions.archive") : t("actions.restore")}
              </Button>
            }
            onConfirm={() =>
              run(() => setGoalArchivedAction(g.id, g.version, active), { success: active ? t("archive.success") : t("archive.restored") })
            }
          />
        </div>
      ) : null}
      <Section title={t("detail.chartTitle")} description={t("detail.chartDescription")}>
        <GoalChart data={d.chart} currency={g.currency} target={g.target} />
      </Section>
      <Section
        title={t("history.title")}
        description={g.kind === "account" ? t("history.accountDescription") : t("history.manualDescription")}
      >
        {d.history.length ? (
          <ul className="grid grid-cols-1 divide-y">
            {d.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p>{formatDateFull(h.date, locale)}</p>
                  <p className="text-xs text-muted-foreground break-words">{h.comment}</p>
                </div>
                <span className="font-medium tabular">{formatMoney(h.amount, g.currency, { locale, sign: true })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">{t("history.empty")}</p>
        )}
      </Section>
      {mode === "edit" ? (
        <GoalEditor goal={g} accounts={accounts} today={d.today} currency={g.currency} onClose={() => setMode(null)} />
      ) : null}
      {mode === "contribute" || mode === "auto" ? (
        <FundingForm mode={mode} goal={g} accounts={accounts} today={d.today} onClose={() => setMode(null)} />
      ) : null}
    </div>
  )
}

function FundingForm({
  mode,
  goal: g,
  accounts,
  today,
  onClose,
}: {
  mode: "contribute" | "auto"
  goal: GoalSummary
  accounts: GoalAccount[]
  today: string
  onClose: () => void
}) {
  const t = useTranslations("goals")
  const locale = useLocale()
  const { run, pending } = useAction()
  const sources = accounts.filter((a) => a.id !== g.accountId && a.kind !== "loan" && !a.archivedAt)
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "")
  const source = sources.find((a) => a.id === sourceId)
  const manual = g.kind === "manual"
  const [amount, setAmount] = useState("")
  const [toAmount, setToAmount] = useState("")
  const [direction, setDirection] = useState("add")
  const [date, setDate] = useState<string | null>(today)
  const [comment, setComment] = useState("")
  const [day, setDay] = useState(5)
  const [error, setError] = useState("")
  const schedule =
    mode === "auto" && g.targetDate && g.fundingGap !== null ? automaticGoalSchedule(today, g.targetDate, day, g.fundingGap) : null
  const crossCurrency = !manual && source?.currency !== g.accountCurrency
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const success = { success: mode === "auto" ? t("funding.automated") : t("funding.recorded"), onSuccess: onClose }
    if (mode === "auto") {
      run(() => automateGoalAction(g.id, { accountId: sourceId, day, version: g.version }), success)
      return
    }
    const parsed = parseMoney(amount, manual ? g.currency : (source?.currency ?? g.currency))
    const received = crossCurrency ? parseMoney(toAmount, g.accountCurrency!) : undefined
    if (!parsed || !date || (crossCurrency && !received)) {
      setError(t("funding.invalid"))
      return
    }
    if (manual) run(() => contributeToGoalAction(g.id, { amount: direction === "take" ? -parsed : parsed, date, comment }), success)
    else run(() => transferToGoalAction(g.id, { accountId: sourceId, amount: parsed, toAmount: received ?? undefined, date }), success)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="grid grid-cols-1 gap-4">
          <DialogHeader>
            <DialogTitle>{mode === "auto" ? t("detail.automate") : t("funding.title")}</DialogTitle>
            <DialogDescription>
              {mode === "auto" ? t("funding.autoDescription") : manual ? t("funding.manualDescription") : t("funding.accountDescription")}
            </DialogDescription>
          </DialogHeader>
          {!manual ? (
            <Field>
              <FieldLabel htmlFor="fund-source">{t("funding.source")}</FieldLabel>
              <AccountSelect id="fund-source" value={sourceId} onChange={setSourceId} accounts={sources} />
              {!sources.length ? (
                <p className="text-sm text-muted-foreground">
                  {t("funding.noSource")}{" "}
                  <LinkButton href="/accounts" variant="link">
                    {t("form.accounts")}
                  </LinkButton>
                </p>
              ) : null}
            </Field>
          ) : null}
          {mode === "auto" ? (
            <>
              <Field>
                <FieldLabel htmlFor="fund-day">{t("funding.day")}</FieldLabel>
                <Input id="fund-day" type="number" min={1} max={31} value={day} onChange={(e) => setDay(Number(e.target.value))} required />
              </Field>
              <p className="text-sm text-muted-foreground">
                {t("funding.schedule", {
                  scheduled: schedule ? "yes" : "no",
                  amount: schedule ? formatMoney(schedule.amount, g.accountCurrency!, { locale }) : "",
                  count: schedule?.count ?? 0,
                })}
              </p>
            </>
          ) : (
            <>
              {manual ? (
                <Segmented
                  value={direction}
                  onChange={setDirection}
                  options={[
                    { value: "add", label: t("funding.add") },
                    { value: "take", label: t("funding.take") },
                  ]}
                />
              ) : null}
              <Field>
                <FieldLabel htmlFor="fund-amount">{manual ? t("form.amount") : t("funding.debit")}</FieldLabel>
                <MoneyInput
                  id="fund-amount"
                  value={amount}
                  onChange={setAmount}
                  currency={manual ? g.currency : source?.currency}
                  required
                />
              </Field>
              {crossCurrency ? (
                <Field>
                  <FieldLabel htmlFor="fund-received">{t("funding.credit")}</FieldLabel>
                  <MoneyInput id="fund-received" value={toAmount} onChange={setToAmount} currency={g.accountCurrency!} required />
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="fund-date">{t("funding.date")}</FieldLabel>
                <DateField id="fund-date" value={date} today={today} onChange={setDate} />
              </Field>
              {manual ? (
                <Field>
                  <FieldLabel htmlFor="fund-comment">{t("funding.comment")}</FieldLabel>
                  <Input id="fund-comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
                </Field>
              ) : null}
            </>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("actions.cancel")}
            </Button>
            <Button type="submit" disabled={pending || (!manual && !sourceId) || (mode === "auto" && !schedule)}>
              {mode === "auto" ? t("funding.setup") : t("funding.record")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
