import { csvAmount, toCsv } from "@/domain/csv"
import { todayIn } from "@/lib/dates"
import { AppError } from "@/server/errors"
import { actionHousehold } from "@/server/session"
import { exportTransactions, transactionFilters } from "@/server/services/transactions"

export const dynamic = "force-dynamic"

const TYPE = { income: "Доход", expense: "Расход", transfer: "Перевод" } as const
const STATUS = { planned: "Запланирована", posted: "Выполнена", skipped: "Пропущена" } as const

/** CSV export of operations of the active household, with the same filters as the operations page. */
export async function GET(request: Request) {
  let ctx
  try {
    ctx = await actionHousehold()
  } catch (err) {
    const status = err instanceof AppError && err.code === "forbidden" ? 403 : 401
    return new Response("Unauthorized", { status })
  }
  const params = Object.fromEntries([...new URL(request.url).searchParams].filter(([k, v]) => k !== "page" && v !== ""))
  const parsed = transactionFilters.safeParse(params)
  if (!parsed.success) return new Response("Bad request", { status: 400 })

  const rows = await exportTransactions(ctx, parsed.data)
  const csv = toCsv([
    ["Дата", "Тип", "Статус", "Название", "Категория", "Счёт", "Счёт зачисления", "Сумма", "Валюта", "Описание", "Автор"],
    ...rows.map((r) => [
      r.date,
      TYPE[r.type],
      STATUS[r.status],
      r.title,
      r.categoryName ?? "",
      r.accountName,
      r.toAccountName ?? "",
      csvAmount(r.type === "expense" ? -r.amount : r.amount),
      ctx.currency,
      r.description ?? "",
      r.authorName ?? "",
    ]),
  ])
  const filename = `bestbudget-operations-${todayIn(ctx.timezone)}.csv`
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
