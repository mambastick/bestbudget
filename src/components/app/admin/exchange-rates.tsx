"use client"

import { useState } from "react"
import { refreshExchangeRatesAction, saveManualRateAction } from "@/app/actions/exchange-rates"
import { CurrencySelect } from "@/components/app/currency-select"
import { Section } from "@/components/app/settings/section"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAction } from "@/hooks/use-action"
import type { Currency } from "@/lib/currencies"
import type { ExchangeRate } from "@/lib/exchange-rates"

export function ExchangeRatesSettings({ rates, today, provider }: { rates: ExchangeRate[]; today: string; provider: "cbr" | "none" }) {
  const [currency, setCurrency] = useState<Currency>("USD")
  const [date, setDate] = useState(today)
  const [rateToRub, setRate] = useState("")
  const { pending, run } = useAction()
  return (
    <Section title="Курсы валют" description={`Источник: ${provider === "cbr" ? "ЦБ РФ с кешем в базе" : "только ручные курсы"}. Курсы общие для всех пространств; ручной курс имеет приоритет на ту же дату.`}>
      <form className="grid grid-cols-1 gap-4 sm:max-w-md" onSubmit={(e) => {
        e.preventDefault()
        run(() => saveManualRateAction({ currency, date, rateToRub }), { success: "Ручной курс сохранён" })
      }}>
        <Field><FieldLabel htmlFor="fx-date">Дата курса</FieldLabel><Input id="fx-date" type="date" required max={today} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field><FieldLabel htmlFor="fx-currency">Валюта</FieldLabel><CurrencySelect id="fx-currency" value={currency} onChange={setCurrency} /></Field>
        <Button type="button" variant="outline" disabled={pending || provider === "none" || currency === "RUB"} onClick={() => run(() => refreshExchangeRatesAction(date, currency), { success: "Курсы обновлены" })}>Обновить курсы</Button>
        <p className="text-xs text-muted-foreground">За прошедшую дату загружается история выбранной валюты за предшествующие 14 дней; за сегодня — все свежие курсы.</p>
        <Field><FieldLabel htmlFor="fx-rate">Рублей за 1 {currency}</FieldLabel><Input id="fx-rate" inputMode="decimal" required value={rateToRub} onChange={(e) => setRate(e.target.value)} placeholder="Например, 95,1234" /></Field>
        <Button type="submit" disabled={pending || currency === "RUB"}>Сохранить ручной курс</Button>
      </form>
      <ul className="mt-6 divide-y text-sm">
        {rates.map((rate) => <li key={`${rate.currency}:${rate.date}:${rate.source}`} className="flex flex-wrap justify-between gap-2 py-2">
          <span>{rate.date} · {rate.currency} · {rate.source === "manual" ? "ручной" : "ЦБ"}</span>
          <span className="tabular">{rate.rateToRub.replace(/0+$/, "").replace(/\.$/, "").replace(".", ",")} ₽</span>
        </li>)}
        {!rates.length ? <li className="py-3 text-muted-foreground">Курсов пока нет. Обновите их или введите вручную.</li> : null}
      </ul>
    </Section>
  )
}
