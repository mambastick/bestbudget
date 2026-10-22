"use client"

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
  const [tab, setTab] = useState("active")
  const [creating, setCreating] = useState(false)
  const visible = goals.filter((g) => (g.status === "archived") === (tab === "archived"))
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          aria-label="Статус целей"
          value={tab}
          onChange={setTab}
          options={[
            { value: "active", label: "Активные" },
            { value: "archived", label: "Архив" },
          ]}
        />
        {canWrite ? <Button onClick={() => setCreating(true)}>Создать цель</Button> : null}
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
          title={tab === "archived" ? "Архив пуст" : "На что копим?"}
          description="Отпуск, машина или финансовая подушка — задайте цель и следите за прогрессом."
        />
      )}
      {creating ? (
        <GoalEditor goal={null} accounts={accounts} today={today} currency={currency} onClose={() => setCreating(false)} />
      ) : null}
    </>
  )
}
