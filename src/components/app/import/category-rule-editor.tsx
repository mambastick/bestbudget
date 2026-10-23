"use client"

import { useState } from "react"
import { saveCategoryRuleAction } from "@/app/actions/import"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MoneyInput } from "@/components/app/money-input"
import { parseMoney } from "@/lib/money"
import { ImportSelect } from "./import-select"
import { CurrencySelect } from "@/components/app/currency-select"
import type { Currency } from "@/lib/currencies"

export function CategoryRuleEditor({ categories }: { categories: { id: string; name: string; kind: string }[] }) {
  const [category, setCategory] = useState("none")
  const [mode, setMode] = useState("substring")
  const [pattern, setPattern] = useState("")
  const [mcc, setMcc] = useState("")
  const [minimum, setMinimum] = useState("")
  const [maximum, setMaximum] = useState("")
  const [priority, setPriority] = useState(100)
  const [currency, setCurrency] = useState<Currency>("RUB")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const save = async () => {
    setBusy(true)
    setMessage("")
    const result = await saveCategoryRuleAction({
      categoryId: category,
      descriptionMode: mode as "substring" | "regex",
      descriptionPattern: pattern || null,
      mcc: mcc || null,
      currency,
      minAmount: minimum ? parseMoney(minimum, currency) : null,
      maxAmount: maximum ? parseMoney(maximum, currency) : null,
      priority,
    })
    setBusy(false)
    setMessage(result.ok ? "Правило сохранено. Оно применится при следующем предпросмотре." : result.error)
  }
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">Создать правило категории с условиями</summary>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ImportSelect
          label="Категория правила"
          value={category}
          onChange={setCategory}
          options={[
            { value: "none", label: "Выберите категорию" },
            ...categories.map((c) => ({ value: c.id, label: `${c.kind === "income" ? "Доход" : "Расход"} · ${c.name}` })),
          ]}
        />
        <ImportSelect
          label="Условие описания"
          value={mode}
          onChange={setMode}
          options={[
            { value: "substring", label: "Содержит подстроку" },
            { value: "regex", label: "Регулярное выражение RE2" },
          ]}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="rule-pattern">Подстрока / выражение (необязательно)</Label>
          <Input id="rule-pattern" maxLength={200} value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rule-mcc">MCC (необязательно)</Label>
          <Input id="rule-mcc" maxLength={4} value={mcc} onChange={(e) => setMcc(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rule-currency">Валюта правила</Label>
          <CurrencySelect
            id="rule-currency"
            value={currency}
            onChange={(v) => {
              setCurrency(v)
              setMinimum("")
              setMaximum("")
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rule-min">Модуль суммы от ({currency})</Label>
          <MoneyInput id="rule-min" currency={currency} value={minimum} onChange={setMinimum} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rule-max">Модуль суммы до ({currency})</Label>
          <MoneyInput id="rule-max" currency={currency} value={maximum} onChange={setMaximum} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rule-priority">Приоритет (больше — раньше)</Label>
          <Input
            id="rule-priority"
            type="number"
            min={-1000}
            max={1000}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
          />
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Условия объединяются через «и». Правило действует для выбранной валюты. RE2 не поддерживает lookaround и обратные ссылки. После
          сохранения создайте предпросмотр заново.
        </p>
        <Button disabled={busy || category === "none"} onClick={() => void save()}>
          Сохранить правило
        </Button>
        {message ? (
          <p role="status" className="break-words text-sm">
            {message}
          </p>
        ) : null}
      </div>
    </details>
  )
}
