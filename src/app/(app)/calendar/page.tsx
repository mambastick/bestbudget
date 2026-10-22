import { FxWarnings } from "@/components/app/fx-warnings"
import type { Metadata } from "next"
import { CalendarView } from "@/components/app/calendar-view"
import { MonthSwitcher } from "@/components/app/month-switcher"
import { PageHeader } from "@/components/app/page-header"
import { isIsoDate, monthKey, parseMonthKey, todayIn } from "@/lib/dates"
import { requireHousehold } from "@/server/session"
import { getCalendarMonth } from "@/server/services/reports"

export const metadata: Metadata = { title: "Календарь" }

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; day?: string }> }) {
  const ctx = await requireHousehold()
  const sp = await searchParams
  const today = todayIn(ctx.timezone)
  const month = parseMonthKey(sp.month, today)
  const data = await getCalendarMonth(ctx, month)
  const initialDay = sp.day && isIsoDate(sp.day) && monthKey(sp.day) === monthKey(month) ? sp.day : monthKey(today) === monthKey(month) ? today : month

  return (
    <div className="grid grid-cols-1 gap-6">
      <FxWarnings warnings={data.warnings} />
      <PageHeader
        title="Календарь"
        description="Фактические и запланированные операции по дням, прогноз остатка"
        actions={<MonthSwitcher month={month} today={today} basePath="/calendar" />}
      />
      <CalendarView key={month} days={data.days} items={data.items} today={today} initialDay={initialDay} />
    </div>
  )
}
