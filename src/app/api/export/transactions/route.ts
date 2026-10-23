import { getLocale, getTranslations } from "next-intl/server"
import { csvAmount, toCsv } from "@/domain/csv"
import { todayIn } from "@/lib/dates"
import { AppError } from "@/server/errors"
import { actionHousehold } from "@/server/session"
import { exportTransactions, transactionFilters } from "@/server/services/transactions"

export const dynamic = "force-dynamic"

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

  const locale = await getLocale()
  const t = await getTranslations("transactions")
  const rows = await exportTransactions(ctx, parsed.data)
  const csv = toCsv([
    [t("csv.date"), t("csv.type"), t("csv.status"), t("csv.title"), t("csv.category"), t("csv.account"), t("csv.destinationAccount"), t("csv.amount"), t("csv.currency"), t("csv.credited"), t("csv.destinationCurrency"), t("csv.description"), t("csv.author"), t("csv.transactionId")],
    ...rows.map((r) => [
      r.date,
      t(`types.${r.type}`),
      t(`statuses.${r.status}`),
      r.title,
      r.categoryName ?? "",
      r.accountName,
      r.toAccountName ?? "",
      csvAmount(r.type === "expense" ? -r.amount : r.amount, r.currency, locale),
      r.currency,
      r.type === "transfer" ? csvAmount(r.toAmount ?? r.amount, r.toCurrency!, locale) : "",
      r.toCurrency ?? "",
      r.description ?? "",
      r.authorName ?? "",
      r.id,
    ]),
  ], locale)
  const filename = `bestbudget-operations-${todayIn(ctx.timezone)}.csv`
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
