"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Section } from "@/components/app/settings/section"
import { LinkButton } from "@/components/app/link-button"
import { plural } from "@/lib/plural"
import { PROFILES, profileMapping } from "@/domain/import/profiles"
import { mappingSchema, type ColumnField, type ColumnMapping, type FileOptions, type PreviewInput } from "@/domain/import/types"
import type { describeStatement } from "@/server/import/file"
import type { ActionResult } from "@/server/errors"
import { ImportStepper } from "./import-stepper"
import { ImportSelect } from "./import-select"

type Inspection = ReturnType<typeof describeStatement>
type SavedProfile = { id: string; name: string; config: Pick<PreviewInput, "file" | "mapping"> }
const fields: { key: ColumnField; label: string }[] = [
  { key: "date", label: "Дата операции" },
  { key: "bookingDate", label: "Дата проводки (приоритетная)" },
  { key: "amount", label: "Сумма" },
  { key: "income", label: "Приход" },
  { key: "expense", label: "Расход" },
  { key: "direction", label: "Направление" },
  { key: "description", label: "Описание" },
  { key: "currency", label: "Валюта" },
  { key: "account", label: "Счёт в файле" },
  { key: "status", label: "Статус (posted / pending / rejected)" },
  { key: "mcc", label: "MCC" },
  { key: "bankCategory", label: "Категория банка" },
  { key: "externalId", label: "Стабильный банковский ID" },
  { key: "balance", label: "Остаток после операции" },
  { key: "originalAmount", label: "Исходная сумма покупки" },
  { key: "originalCurrency", label: "Исходная валюта покупки" },
]

export function ImportWizard({
  accounts,
  profiles,
}: {
  accounts: { id: string; name: string; currency: string }[]
  profiles: SavedProfile[]
}) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [options, setOptions] = useState<FileOptions>({ encoding: "auto", delimiter: "auto", sheet: 0, headerRow: 1 })
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>(mappingSchema.parse({ columns: {} }))
  const [profile, setProfile] = useState("custom")
  const [accountMap, setAccountMap] = useState<Record<string, string>>({})
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "")
  const [name, setName] = useState("")
  const [plannedDays, setPlannedDays] = useState(3)
  const [tolerance, setTolerance] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const custom = !PROFILES.some((p) => p.id === profile && p.id !== "custom")
  const accountOptions = [
    { value: "none", label: "Сопоставьте счёт" },
    ...accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}` })),
  ]
  const hints = [
    ...new Set([
      ...(inspection?.columnValues[mapping.columns.account ?? -1] ?? []),
      ...(profile === "bestbudget-export" ? (inspection?.columnValues[mapping.columns.toAccount ?? -1] ?? []) : []),
    ]),
  ]
  const changeFileOptions = (patch: Partial<FileOptions>) => {
    setOptions({ ...options, ...patch })
    setInspection(null)
  }
  const upload = async (mode: "inspect" | "preview") => {
    const file = fileInput.current?.files?.[0]
    if (!file) {
      setError("Выберите файл")
      return
    }
    setBusy(true)
    setError("")
    try {
      const config =
        mode === "inspect"
          ? options
          : {
              file: options,
              profile,
              mapping,
              accounts: accountMap,
              defaultAccountId: accountId || undefined,
              saveProfileName: custom && name ? name : undefined,
              plannedDays,
              plannedTolerance: tolerance,
            }
      const form = new FormData()
      form.set("file", file)
      form.set("mode", mode)
      form.set("config", JSON.stringify(config))
      const response = await fetch("/api/import", { method: "POST", body: form })
      const result = (await response.json()) as ActionResult<Inspection | { id: string }>
      if (!result.ok) {
        setError(result.error)
        return
      }
      if ("id" in result.data) {
        router.push(`/transactions/import?batch=${result.data.id}`)
        return
      }
      setInspection(result.data)
      const saved = profiles.find((p) => p.id === profile)
      if (saved) setMapping(saved.config.mapping)
      else {
        setProfile(result.data.profile)
        setMapping(result.data.mapping)
      }
    } catch {
      setError("Не удалось загрузить файл. Проверьте соединение и повторите.")
    } finally {
      setBusy(false)
    }
  }
  const selectProfile = (value: string) => {
    setProfile(value)
    const saved = profiles.find((p) => p.id === value)
    if (saved) setMapping(saved.config.mapping)
    else if (inspection && value !== "custom") {
      try {
        setMapping(profileMapping(value, inspection.headers))
      } catch {
        setError("Заголовки неоднозначны. Используйте мастер колонок.")
        setProfile("custom")
      }
    }
  }
  return (
    <>
      <ImportStepper step={inspection ? 2 : 1} />
      <Section
        title="Файл и чтение"
        description="Оригинал остаётся только в памяти на время чтения. В истории сохраняются нормализованные строки."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5 sm:col-span-2">
            <Label htmlFor="statement-file">Выписка CSV / XLSX</Label>
            <Input ref={fileInput} id="statement-file" type="file" className="h-auto" onChange={() => setInspection(null)} />
          </div>
          <ImportSelect
            label="Кодировка CSV"
            value={options.encoding}
            onChange={(v) => changeFileOptions({ encoding: v as FileOptions["encoding"] })}
            options={[
              { value: "auto", label: "Авто (строгий UTF-8 / BOM)" },
              { value: "utf-8", label: "UTF-8" },
              { value: "windows-1251", label: "Windows-1251" },
              { value: "utf-16le", label: "UTF-16 LE" },
              { value: "utf-16be", label: "UTF-16 BE" },
            ]}
          />
          <ImportSelect
            label="Разделитель CSV"
            value={options.delimiter}
            onChange={(v) => changeFileOptions({ delimiter: v as FileOptions["delimiter"] })}
            options={[
              { value: "auto", label: "Авто" },
              { value: ";", label: "Точка с запятой (;)" },
              { value: ",", label: "Запятая (,)" },
              { value: "\t", label: "Табуляция" },
            ]}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="header-row">Строка заголовков</Label>
            <Input
              id="header-row"
              type="number"
              min={1}
              max={1000}
              value={options.headerRow}
              onChange={(e) => changeFileOptions({ headerRow: Number(e.target.value) })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sheet-index">Номер листа XLSX</Label>
            <Input
              id="sheet-index"
              type="number"
              min={1}
              max={100}
              value={options.sheet + 1}
              onChange={(e) => changeFileOptions({ sheet: Number(e.target.value) - 1 })}
            />
          </div>
          {inspection?.kind === "xlsx" ? (
            <ImportSelect
              label="Лист XLSX"
              value={String(options.sheet)}
              onChange={(v) => changeFileOptions({ sheet: Number(v) })}
              options={inspection.sheets.map((label, index) => ({ value: String(index), label }))}
            />
          ) : null}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button disabled={busy} onClick={() => void upload("inspect")}>
              {busy ? "Чтение…" : "Прочитать файл"}
            </Button>
            <LinkButton variant="outline" href="/api/import/template">
              Скачать шаблон CSV v1
            </LinkButton>
          </div>
          <ImportSelect
            label="Сохранённые настройки чтения"
            value={profiles.some((p) => p.id === profile) ? profile : "none"}
            options={[{ value: "none", label: "Выберите профиль перед чтением" }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={(id) => {
              const saved = profiles.find((p) => p.id === id)
              if (saved) {
                setOptions(saved.config.file)
                setMapping(saved.config.mapping)
                setProfile(id)
                setInspection(null)
              }
            }}
          />
        </div>
      </Section>
      {inspection ? (
        <Section
          title="Настройка"
          description={`${inspection.rowCount} ${plural(inspection.rowCount, "строка", "строки", "строк")} · листы: ${inspection.sheets.join(", ")}. Сверьте заголовки и первые строки.`}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <ImportSelect
                label="Профиль"
                value={profile}
                onChange={selectProfile}
                options={[
                  ...PROFILES.map((p) => ({ value: p.id, label: p.name })),
                  ...profiles.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </div>
            {profile.startsWith("tbank") ? (
              <p className="text-sm text-amber-700 sm:col-span-2 dark:text-amber-400">
                Экспериментальный профиль. Формат 2026 года не подтверждён образцом: проверьте знаки, даты, статусы и валюты.
              </p>
            ) : null}
            <ImportSelect
              label="Счёт для строк без названия счёта"
              value={accountId || "none"}
              onChange={(v) => setAccountId(v === "none" ? "" : v)}
              options={accountOptions}
            />
            {hints.map((hint) => (
              <ImportSelect
                key={hint}
                label={`Счёт «${hint}»`}
                value={accountMap[hint] ?? accounts.find((a) => a.name === hint || a.id === hint)?.id ?? "none"}
                onChange={(v) => {
                  const next = { ...accountMap }
                  if (v === "none") delete next[hint]
                  else next[hint] = v
                  setAccountMap(next)
                }}
                options={accountOptions}
              />
            ))}
            {custom ? (
              <>
                <ImportSelect
                  label="Схема суммы"
                  value={mapping.amountMode}
                  onChange={(v) => setMapping({ ...mapping, amountMode: v as ColumnMapping["amountMode"] })}
                  options={[
                    { value: "signed", label: "Подписанная сумма (+ приход / − расход)" },
                    { value: "separate", label: "Две колонки: приход и расход" },
                    { value: "direction", label: "Направление и сумма без знака" },
                  ]}
                />
                <ImportSelect
                  label="Формат даты"
                  value={mapping.dateFormat}
                  onChange={(v) => setMapping({ ...mapping, dateFormat: v as ColumnMapping["dateFormat"] })}
                  options={[
                    { value: "iso", label: "YYYY-MM-DD" },
                    { value: "dmy", label: "DD.MM.YYYY / DD/MM/YYYY" },
                    { value: "mdy", label: "MM/DD/YYYY" },
                  ]}
                />
                <ImportSelect
                  label="Десятичный разделитель"
                  value={mapping.decimal}
                  onChange={(v) => setMapping({ ...mapping, decimal: v as "." | "," })}
                  options={[
                    { value: ".", label: "Точка" },
                    { value: ",", label: "Запятая" },
                  ]}
                />
                <div className="grid gap-1.5">
                  <Label htmlFor="fallback-currency">Валюта, если колонки нет (ISO)</Label>
                  <Input
                    id="fallback-currency"
                    maxLength={3}
                    value={mapping.currency}
                    onChange={(e) => setMapping({ ...mapping, currency: e.target.value.toUpperCase() })}
                  />
                </div>
                {fields
                  .filter(
                    (f) =>
                      !(["income", "expense"].includes(f.key) && mapping.amountMode !== "separate") &&
                      !(f.key === "direction" && mapping.amountMode !== "direction") &&
                      !(f.key === "amount" && mapping.amountMode === "separate"),
                  )
                  .map((field) => (
                    <div className="min-w-0" key={field.key}>
                      <ImportSelect
                        label={`Колонка: ${field.label}`}
                        value={mapping.columns[field.key] === undefined ? "none" : String(mapping.columns[field.key])}
                        onChange={(v) => {
                          const columns = { ...mapping.columns }
                          if (v === "none") delete columns[field.key]
                          else columns[field.key] = Number(v)
                          setMapping({ ...mapping, columns })
                        }}
                        options={[
                          { value: "none", label: "Не выбрана" },
                          ...inspection.headers.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h || "(пусто)"}` })),
                        ]}
                      />
                      <p className="mt-1 break-words text-xs text-muted-foreground">
                        {mapping.columns[field.key] !== undefined
                          ? inspection.sample
                              .map((r) => r[mapping.columns[field.key]!])
                              .filter(Boolean)
                              .slice(0, 2)
                              .join(" · ")
                          : ""}
                      </p>
                    </div>
                  ))}
                {mapping.amountMode === "direction" ? (
                  <>
                    <div className="grid gap-1.5">
                      <Label htmlFor="income-marker">Значение «приход»</Label>
                      <Input
                        id="income-marker"
                        value={mapping.incomeValue}
                        onChange={(e) => setMapping({ ...mapping, incomeValue: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="expense-marker">Значение «расход»</Label>
                      <Input
                        id="expense-marker"
                        value={mapping.expenseValue}
                        onChange={(e) => setMapping({ ...mapping, expenseValue: e.target.value })}
                      />
                    </div>
                  </>
                ) : null}
                <Label className="flex items-start gap-2 sm:col-span-2">
                  <Checkbox checked={mapping.assumePosted} onCheckedChange={(v) => setMapping({ ...mapping, assumePosted: v === true })} />
                  Считать строки без статуса завершёнными проводками (я проверил выписку)
                </Label>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="profile-name">Сохранить настройки новым профилем семьи (необязательно)</Label>
                  <Input id="profile-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                </div>
              </>
            ) : (
              <div className="grid gap-2 text-sm sm:col-span-2">
                {Object.entries(mapping.columns).map(([field, col]) => (
                  <p className="break-words" key={field}>
                    {fields.find((f) => f.key === field)?.label ?? field}: {inspection.headers[col!] ?? "не найдена"} ·{" "}
                    {inspection.sample[0]?.[col!] ?? ""}
                  </p>
                ))}
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="planned-days">Окно плановых операций (дней)</Label>
              <Input
                id="planned-days"
                type="number"
                min={0}
                max={14}
                value={plannedDays}
                onChange={(e) => setPlannedDays(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="planned-tolerance">Допуск суммы, копейки / центы</Label>
              <Input
                id="planned-tolerance"
                type="number"
                min={0}
                max={100_000_000}
                step={1}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Для JPY/KRW — целые единицы, для BHD — тысячные.</p>
            </div>
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Автоматической конвертации нет: валюта строки должна совпадать с валютой выбранного счёта. Новые счета не создаются.
            </p>
            <Button className="sm:col-span-2" disabled={busy} onClick={() => void upload("preview")}>
              {busy ? "Подготовка…" : "Подготовить предпросмотр"}
            </Button>
          </div>
        </Section>
      ) : null}
      {error ? (
        <p role="alert" className="break-words text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  )
}
