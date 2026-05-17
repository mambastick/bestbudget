import type {
  CalendarDayQuery,
  CalendarDayResponse,
} from "../../api/schemas/calendar"

const demoItems = [
  {
    id: "cal_salary_may_2026",
    date: "2026-05-20",
    type: "salary",
    status: "planned",
    title: "Ожидаемая зарплата",
    amount: "240000.00",
    currency: "RUB",
    sourceId: "salary_main",
  },
  {
    id: "cal_mortgage_may_2026",
    date: "2026-05-25",
    type: "liability_payment",
    status: "planned",
    title: "Ипотека — ежемесячный платеж",
    amount: "132844.00",
    currency: "RUB",
    sourceId: "liability_mortgage",
  },
  {
    id: "cal_utilities_may_2026",
    date: "2026-05-25",
    type: "expense",
    status: "planned",
    title: "Коммунальные услуги",
    amount: "14500.00",
    currency: "RUB",
    sourceId: "rule_utilities",
  },
] as const

export function getCalendarMonth(householdId: string, month: string) {
  return {
    householdId,
    month,
    items: demoItems.filter((item) => item.date.startsWith(month)),
  }
}

export function getCalendarDay(query: CalendarDayQuery): CalendarDayResponse {
  const items = demoItems.filter((item) => item.date === query.date)
  const plannedOutflow = items
    .filter((item) => item.status === "planned" && item.type !== "salary")
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
  const plannedInflow = items
    .filter((item) => item.status === "planned" && item.type === "salary")
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0)

  return {
    date: query.date,
    summary: {
      plannedOutflow: plannedOutflow.toFixed(2),
      actualOutflow: "0.00",
      plannedInflow: plannedInflow.toFixed(2),
      actualInflow: "0.00",
    },
    items: items.map(({ date: _date, ...item }) => item),
  }
}
