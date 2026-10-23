"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { refreshExchangeRatesAction, saveManualRateAction } from "@/app/actions/exchange-rates"
import { CurrencySelect } from "@/components/app/currency-select"
import { Section } from "@/components/app/settings/section"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAction } from "@/hooks/use-action"
import type { Currency } from "@/lib/currencies"
import { formatDateFull } from "@/lib/dates"
import type { ExchangeRate } from "@/lib/exchange-rates"

export function ExchangeRatesSettings({ rates, today, provider }: { rates: ExchangeRate[]; today: string; provider: "cbr" | "none" }) {
  const t = useTranslations("admin")
  const locale = useLocale()
  const [currency, setCurrency] = useState<Currency>("USD")
  const [date, setDate] = useState(today)
  const [rateToRub, setRate] = useState("")
  const { pending, run } = useAction()
  return (
    <Section title={t("rates")} description={t("ratesHint", { source: t(provider === "cbr" ? "sourceCbr" : "sourceManual") })}>
      <form className="grid grid-cols-1 gap-4 sm:max-w-md" onSubmit={(e) => {
        e.preventDefault()
        run(() => saveManualRateAction({ currency, date, rateToRub }), { success: t("rateSaved") })
      }}>
        <Field><FieldLabel htmlFor="fx-date">{t("rateDate")}</FieldLabel><Input id="fx-date" type="date" required max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="fx-currency">{t("currency")}</FieldLabel><CurrencySelect id="fx-currency" value={currency} onChange={setCurrency} /></Field>
        <Button type="button" variant="outline" disabled={pending || provider === "none" || currency === "RUB"} onClick={() => run(() => refreshExchangeRatesAction(date, currency), { success: t("ratesUpdated") })}>{t("refreshRates")}</Button>
        <p className="text-xs text-muted-foreground">{t("refreshHint")}</p>
        <Field><FieldLabel htmlFor="fx-rate">{t("rublesPerUnit", { currency })}</FieldLabel><Input id="fx-rate" inputMode="decimal" required value={rateToRub} onChange={(e) => setRate(e.target.value)} placeholder={t("rateExample")} /></Field>
        <Button type="submit" disabled={pending || currency === "RUB"}>{t("saveRate")}</Button>
      </form>
      <ul className="mt-6 divide-y text-sm">
        {rates.map((rate) => <li key={`${rate.currency}:${rate.date}:${rate.source}`} className="flex flex-wrap justify-between gap-2 py-2">
          <span>{formatDateFull(rate.date, locale)} · {rate.currency} · {rate.source === "manual" ? t("manual") : t("cbr")}</span>
          <span className="tabular">{rate.rateToRub.replace(/0+$/, "").replace(/\.$/, "").replace(".", new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")!.value)} ₽</span>
        </li>)}
        {!rates.length ? <li className="py-3 text-muted-foreground">{t("noRates")}</li> : null}
      </ul>
    </Section>
  )
}
