import { ChevronLeft, ChevronRight } from "lucide-react"
import { LinkButton } from "@/components/app/link-button"
import { addMonths, formatMonth, monthKey, type IsoDate } from "@/lib/dates"

/** Month navigation via the `?month=YYYY-MM` search param, so views are linkable and server-rendered. */
export function MonthSwitcher({ month, today, basePath }: { month: IsoDate; today: IsoDate; basePath: string }) {
  const href = (m: IsoDate) => `${basePath}?month=${monthKey(m)}`
  const isCurrent = monthKey(month) === monthKey(today)
  return (
    <div className="flex items-center gap-1">
      <LinkButton variant="outline" size="icon" href={href(addMonths(month, -1))} aria-label="Предыдущий месяц">
        <ChevronLeft />
      </LinkButton>
      <div className="min-w-36 text-center text-sm font-medium">{formatMonth(month)}</div>
      <LinkButton variant="outline" size="icon" href={href(addMonths(month, 1))} aria-label="Следующий месяц">
        <ChevronRight />
      </LinkButton>
      {!isCurrent ? (
        <LinkButton variant="ghost" size="sm" href={basePath}>
          Сегодня
        </LinkButton>
      ) : null}
    </div>
  )
}
