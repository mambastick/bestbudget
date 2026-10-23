"use client"

import { useTranslations } from "next-intl"

import { useState } from "react"
import { Target } from "lucide-react"
import { EmptyState } from "@/components/app/empty-state"
import { Segmented } from "@/components/app/segmented"
import { Button } from "@/components/ui/button"
import type { GoalSummary } from "@/server/services/goals"
import { GoalCard } from "./goal-card"
import { GoalEditor, type GoalAccount } from "./goal-editor"

export function GoalsView({
  goals,
  accounts,
  today,
  currency,
  canWrite,
}: {
  goals: GoalSummary[]
  accounts: GoalAccount[]
  today: string
  currency: string
  canWrite: boolean
}) {
  const t = useTranslations("goals")
  const [tab, setTab] = useState("active")
  const [creating, setCreating] = useState(false)
  const visible = goals.filter((g) => (g.status === "archived") === (tab === "archived"))
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          aria-label={t("view.status")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "active", label: t("view.active") },
            { value: "archived", label: t("view.archived") },
          ]}
        />
        {canWrite ? <Button onClick={() => setCreating(true)}>{t("view.create")}</Button> : null}
      </div>
      {visible.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Target}
          title={tab === "archived" ? t("view.emptyArchive") : t("view.emptyTitle")}
          description={t("view.emptyDescription")}
        />
      )}
      {creating ? (
        <GoalEditor goal={null} accounts={accounts} today={today} currency={currency} onClose={() => setCreating(false)} />
      ) : null}
    </>
  )
}
