"use client"

import Link from "next/link"
import { motion, useReducedMotion } from "motion/react"
import { Check } from "lucide-react"
import { CategoryIcon } from "@/components/app/category-icon"
import { GOAL_STATUS_LABELS } from "@/domain/goals"
import { formatDateFull } from "@/lib/dates"
import { formatMoney } from "@/lib/money"
import type { GoalSummary } from "@/server/services/goals"

export function GoalCard({ goal: g }: { goal: GoalSummary }) {
  const reduced = useReducedMotion()
  const known = g.target !== null && g.progress !== null
  return (
    <article className="min-w-0 rounded-xl border bg-card p-5" data-testid="goal-card">
      <div className="flex items-start gap-3">
        <CategoryIcon icon={g.icon} color={g.color} />
        <div className="min-w-0 flex-1">
          <Link href={`/goals/${g.id}`} className="block font-semibold break-words hover:underline">
            {g.name}
          </Link>
          <p className="mt-1 text-xs text-muted-foreground break-words">
            {g.accountName ?? "Ручная копилка"}
            {g.expenseMonths ? ` · ${g.expenseMonths} мес. расходов` : ""}
          </p>
        </div>
        {g.status === "achieved" ? (
          <motion.span
            aria-label="Достигнута"
            initial={reduced ? false : { scale: 0.7 }}
            animate={{ scale: 1 }}
            className="rounded-full bg-primary/10 p-1 text-primary"
          >
            <Check className="size-4" />
          </motion.span>
        ) : null}
      </div>
      <div className="mt-5 flex flex-wrap items-baseline justify-between gap-1">
        <span className="text-xl font-semibold tabular" data-testid="goal-progress">
          {g.progress === null ? "Нет курса" : formatMoney(g.progress, g.currency)}
        </span>
        <span className="text-xs text-muted-foreground">из {g.target === null ? "—" : formatMoney(g.target, g.currency)}</span>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`Прогресс: ${g.name}`}
        aria-valuenow={known ? g.percent : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: g.color }}
          initial={false}
          animate={{ width: `${known ? g.percent : 0}%` }}
          transition={{ duration: reduced ? 0 : 0.4 }}
        />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
        <span>
          {known ? `${g.percent}% · ` : ""}
          {g.status === "archived"
            ? "В архиве"
            : !known
              ? "Нужен курс"
              : g.target === 0
                ? "Нет расходов для расчёта"
                : GOAL_STATUS_LABELS[g.status]}
        </span>
        {g.targetDate ? <span>К {formatDateFull(g.targetDate)}</span> : null}
      </div>
      {known && g.status !== "archived" && g.remaining > 0 && g.monthlyRequired !== null ? (
        <p className="mt-4 text-sm">
          Откладывайте <strong>{formatMoney(g.monthlyRequired, g.currency)}/мес</strong>
        </p>
      ) : null}
      {g.rateNote ? <p className="mt-2 text-xs text-muted-foreground">{g.rateNote}</p> : null}
      {g.automation ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Автопополнение: {formatMoney(g.automation.amount, g.automation.currency)} · {g.automation.day}-го числа
        </p>
      ) : null}
    </article>
  )
}
