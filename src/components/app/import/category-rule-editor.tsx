"use client"

import { useTranslations } from "next-intl"

import { useState } from "react"
import { saveCategoryRuleAction } from "@/app/actions/import"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MoneyInput } from "@/components/app/money-input"
import { parseMoney } from "@/lib/money"
import { ImportSelect } from "./import-select"
import { CurrencySelect } from "@/components/app/currency-select"
import type { Currency } from "@/lib/currencies"

export function CategoryRuleEditor({ categories }: { categories: { id: string; name: string; kind: string }[] }) {
  const t = useTranslations("import")
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
    setMessage(result.ok ? t("rule.saved") : result.error)
  }
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" className="h-auto justify-start whitespace-normal text-left" />}>
        {t("rule.create")}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("rule.title")}</DialogTitle>
          <DialogDescription>{t("rule.description")}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ImportSelect
            label={t("rule.category")}
            value={category}
            onChange={setCategory}
            options={[
              { value: "none", label: t("bulk.chooseCategory") },
              ...categories.map((c) => ({
                value: c.id,
                label: `${c.kind === "income" ? t("category.income") : t("fields.expense")} · ${c.name}`,
              })),
            ]}
          />
          <ImportSelect
            label={t("rule.condition")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "substring", label: t("rule.substring") },
              { value: "regex", label: t("rule.regex") },
            ]}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="rule-pattern">{t("rule.pattern")}</Label>
            <Input id="rule-pattern" maxLength={200} value={pattern} onChange={(e) => setPattern(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-mcc">{t("rule.mcc")}</Label>
            <Input id="rule-mcc" maxLength={4} value={mcc} onChange={(e) => setMcc(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-currency">{t("rule.currency")}</Label>
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
            <Label htmlFor="rule-min">{t("rule.min", { currency })}</Label>
            <MoneyInput id="rule-min" currency={currency} value={minimum} onChange={setMinimum} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-max">{t("rule.max", { currency })}</Label>
            <MoneyInput id="rule-max" currency={currency} value={maximum} onChange={setMaximum} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="rule-priority">{t("rule.priority")}</Label>
            <Input
              id="rule-priority"
              type="number"
              min={-1000}
              max={1000}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("rule.hint")}</p>
          <Button disabled={busy || category === "none"} onClick={() => void save()}>
            {t("rule.save")}
          </Button>
          {message ? (
            <p role="status" className="break-words text-sm">
              {message}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
