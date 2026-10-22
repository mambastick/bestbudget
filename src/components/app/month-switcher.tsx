import { ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { addMonths, formatMonth, monthKey, type IsoDate } from "@/lib/dates"

/** Month navigation via the `?month=YYYY-MM` search param, so views are linkable and server-rendered. */
export function MonthSwitcher({ month, today, basePath }: { month: IsoDate; today: IsoDate; basePath: string }) {
  const href = (m: IsoDate) => `${basePath}?month=${monthKey(m)}`
  const isCurrent = monthKey(month) === monthKey(today)
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" render={<Link href={href(addMonths(month, -1))} aria-label="Предыдущий месяц" />}>
        <ChevronLeft />
      </Button>
      <div className="min-w-36 text-center text-sm font-medium">{formatMonth(month)}</div>
      <Button variant="outline" size="icon" render={<Link href={href(addMonths(month, 1))} aria-label="Следующий месяц" />}>
        <ChevronRight />
      </Button>
      {!isCurrent ? (
        <Button variant="ghost" size="sm" render={<Link href={basePath} />}>
          Сегодня
        </Button>
      ) : null}
    </div>
  )
}
