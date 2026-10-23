import { useTranslations, useLocale } from "next-intl"
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
  const t = useTranslations("loans")
  const locale = useLocale()
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("summary.debt")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2">
          <Money value={debt} currency={currency} className="text-2xl font-semibold" />
          <p className="text-xs text-muted-foreground">{t("summary.debtDescription")}</p>
          {next ? (
            <p className="text-sm">
              {t("summary.upcomingDate", { date: formatDateFull(next.date, locale) })} ·{" "}
              <Money value={next.amount} currency={next.currency} />
              <span className="block text-xs text-muted-foreground">{next.title}</span>
            </p>
          ) : null}
          <LinkButton href="/loans" variant="outline" size="sm" className="justify-self-start">
            {t("page.title")}
          </LinkButton>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("summary.netAssets")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2">
          <Money value={netAssets} currency={currency} className="text-2xl font-semibold" />
          <p className="text-xs text-muted-foreground">{t("summary.netAssetsDescription")}</p>
        </CardContent>
      </Card>
    </div>
  )
}
