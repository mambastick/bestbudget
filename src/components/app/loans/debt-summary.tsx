import { LinkButton } from "@/components/app/link-button"
import { Money } from "@/components/app/money"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDateFull } from "@/lib/dates"

export function DebtSummary({
  debt,
  netAssets,
  currency,
  next,
}: {
  debt: number
  netAssets: number
  currency: string
  next?: { date: string; title: string; amount: number; currency: string }
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Долги</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2">
          <Money value={debt} currency={currency} className="text-2xl font-semibold" />
          <p className="text-xs text-muted-foreground">Остатки обязательств, кредитных карт и овердрафтов в базовой валюте семьи.</p>
          {next ? (
            <p className="text-sm">
              Ближайший платёж: {formatDateFull(next.date)} · <Money value={next.amount} currency={next.currency} />
              <span className="block text-xs text-muted-foreground">{next.title}</span>
            </p>
          ) : null}
          <LinkButton href="/loans" variant="outline" size="sm" className="justify-self-start">
            Кредиты
          </LinkButton>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Чистые активы</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2">
          <Money value={netAssets} currency={currency} className="text-2xl font-semibold" />
          <p className="text-xs text-muted-foreground">
            Положительные остатки всех счетов минус обязательства, по курсам на сегодня. Кредитный лимит не считается активом.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
