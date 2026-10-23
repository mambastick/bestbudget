"use client"

import { useTranslations } from "next-intl"

import { useRef, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Section } from "@/components/app/settings/section"
import { LinkButton } from "@/components/app/link-button"

import { PROFILES, profileMapping } from "@/domain/import/profiles"
import { mappingSchema, type ColumnField, type ColumnMapping, type FileOptions, type PreviewInput } from "@/domain/import/types"
import type { describeStatement } from "@/server/import/file"
import type { ActionResult } from "@/server/errors"
import { ImportStepper } from "./import-stepper"
import { ImportSelect } from "./import-select"

type Inspection = ReturnType<typeof describeStatement>
type SavedProfile = { id: string; name: string; config: Pick<PreviewInput, "file" | "mapping"> }

const subscribe = () => () => {}

export function ImportWizard({
  accounts,
  profiles,
}: {
  accounts: { id: string; name: string; currency: string }[]
  profiles: SavedProfile[]
}) {
  const t = useTranslations("import")
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  const fields: { key: ColumnField; label: string }[] = [
    { key: "date", label: t("fields.date") },
    { key: "bookingDate", label: t("fields.bookingDate") },
    { key: "amount", label: t("preview.amount") },
    { key: "income", label: t("fields.income") },
    { key: "expense", label: t("fields.expense") },
    { key: "direction", label: t("fields.direction") },
    { key: "description", label: t("preview.description") },
    { key: "currency", label: t("fields.currency") },
    { key: "account", label: t("fields.account") },
    { key: "status", label: t("fields.status") },
    { key: "mcc", label: "MCC" },
    { key: "bankCategory", label: t("fields.bankCategory") },
    { key: "externalId", label: t("fields.externalId") },
    { key: "balance", label: t("fields.balance") },
    { key: "originalAmount", label: t("fields.originalAmount") },
    { key: "originalCurrency", label: t("fields.originalCurrency") },
  ]

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
    { value: "none", label: t("wizard.mapAccount") },
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
      setError(t("wizard.chooseFile"))
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
      setError(t("wizard.uploadFailed"))
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
        setError(t("wizard.ambiguousHeaders"))
        setProfile("custom")
      }
    }
  }
  return (
    <>
      <ImportStepper step={inspection ? 2 : 1} />
      <Section title={t("wizard.fileTitle")} description={t("wizard.fileDescription")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5 sm:col-span-2">
            <Label htmlFor="statement-file">{t("wizard.file")}</Label>
            <Input ref={fileInput} id="statement-file" type="file" className="h-auto" onChange={() => setInspection(null)} />
          </div>
          <ImportSelect
            label={t("wizard.encoding")}
            value={options.encoding}
            onChange={(v) => changeFileOptions({ encoding: v as FileOptions["encoding"] })}
            options={[
              { value: "auto", label: t("wizard.autoEncoding") },
              { value: "utf-8", label: "UTF-8" },
              { value: "windows-1251", label: "Windows-1251" },
              { value: "utf-16le", label: "UTF-16 LE" },
              { value: "utf-16be", label: "UTF-16 BE" },
            ]}
          />
          <ImportSelect
            label={t("wizard.delimiter")}
            value={options.delimiter}
            onChange={(v) => changeFileOptions({ delimiter: v as FileOptions["delimiter"] })}
            options={[
              { value: "auto", label: t("wizard.auto") },
              { value: ";", label: t("wizard.semicolon") },
              { value: ",", label: t("wizard.commaDelimiter") },
              { value: "\t", label: t("wizard.tab") },
            ]}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="header-row">{t("wizard.headerRow")}</Label>
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
            <Label htmlFor="sheet-index">{t("wizard.sheetIndex")}</Label>
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
              label={t("wizard.sheet")}
              value={String(options.sheet)}
              onChange={(v) => changeFileOptions({ sheet: Number(v) })}
              options={inspection.sheets.map((label, index) => ({ value: String(index), label }))}
            />
          ) : null}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button disabled={!mounted || busy} onClick={() => void upload("inspect")}>
              {busy ? t("wizard.reading") : t("wizard.read")}
            </Button>
            <LinkButton variant="outline" href="/api/import/template">
              {t("wizard.template")}
            </LinkButton>
          </div>
          <ImportSelect
            label={t("wizard.savedOptions")}
            value={profiles.some((p) => p.id === profile) ? profile : "none"}
            options={[{ value: "none", label: t("wizard.chooseProfile") }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]}
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
          title={t("steps.setup")}
          description={t("wizard.inspection", { count: inspection.rowCount, sheets: inspection.sheets.join(", ") })}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <ImportSelect
                label={t("wizard.profile")}
                value={profile}
                onChange={selectProfile}
                options={[
                  ...PROFILES.map((p) => ({ value: p.id, label: t(p.name) })),
                  ...profiles.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </div>
            {profile.startsWith("tbank") ? (
              <p className="text-sm text-amber-700 sm:col-span-2 dark:text-amber-400">{t("wizard.experimental")}</p>
            ) : null}
            <ImportSelect
              label={t("wizard.defaultAccount")}
              value={accountId || "none"}
              onChange={(v) => setAccountId(v === "none" ? "" : v)}
              options={accountOptions}
            />
            {hints.map((hint) => (
              <ImportSelect
                key={hint}
                label={t("wizard.accountHint", { name: hint })}
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
                  label={t("wizard.amountMode")}
                  value={mapping.amountMode}
                  onChange={(v) => setMapping({ ...mapping, amountMode: v as ColumnMapping["amountMode"] })}
                  options={[
                    { value: "signed", label: t("wizard.signed") },
                    { value: "separate", label: t("wizard.separate") },
                    { value: "direction", label: t("wizard.directionAmount") },
                  ]}
                />
                <ImportSelect
                  label={t("wizard.dateFormat")}
                  value={mapping.dateFormat}
                  onChange={(v) => setMapping({ ...mapping, dateFormat: v as ColumnMapping["dateFormat"] })}
                  options={[
                    { value: "iso", label: "YYYY-MM-DD" },
                    { value: "dmy", label: "DD.MM.YYYY / DD/MM/YYYY" },
                    { value: "mdy", label: "MM/DD/YYYY" },
                  ]}
                />
                <ImportSelect
                  label={t("wizard.decimal")}
                  value={mapping.decimal}
                  onChange={(v) => setMapping({ ...mapping, decimal: v as "." | "," })}
                  options={[
                    { value: ".", label: t("wizard.dot") },
                    { value: ",", label: t("wizard.comma") },
                  ]}
                />
                <div className="grid gap-1.5">
                  <Label htmlFor="fallback-currency">{t("wizard.fallbackCurrency")}</Label>
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
                        label={t("wizard.column", { field: field.label })}
                        value={mapping.columns[field.key] === undefined ? "none" : String(mapping.columns[field.key])}
                        onChange={(v) => {
                          const columns = { ...mapping.columns }
                          if (v === "none") delete columns[field.key]
                          else columns[field.key] = Number(v)
                          setMapping({ ...mapping, columns })
                        }}
                        options={[
                          { value: "none", label: t("wizard.unselected") },
                          ...inspection.headers.map((h, i) => ({ value: String(i), label: `${i + 1}. ${h || t("wizard.emptyHeader")}` })),
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
                      <Label htmlFor="income-marker">{t("wizard.incomeMarker")}</Label>
                      <Input
                        id="income-marker"
                        value={mapping.incomeValue}
                        onChange={(e) => setMapping({ ...mapping, incomeValue: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="expense-marker">{t("wizard.expenseMarker")}</Label>
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
                  {t("wizard.assumePosted")}
                </Label>
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="profile-name">{t("wizard.saveProfile")}</Label>
                  <Input id="profile-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
                </div>
              </>
            ) : (
              <div className="grid gap-2 text-sm sm:col-span-2">
                {Object.entries(mapping.columns).map(([field, col]) => (
                  <p className="break-words" key={field}>
                    {fields.find((f) => f.key === field)?.label ?? field}: {inspection.headers[col!] ?? t("wizard.notFound")} ·{" "}
                    {inspection.sample[0]?.[col!] ?? ""}
                  </p>
                ))}
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="planned-days">{t("wizard.plannedDays")}</Label>
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
              <Label htmlFor="planned-tolerance">{t("wizard.tolerance")}</Label>
              <Input
                id="planned-tolerance"
                type="number"
                min={0}
                max={100_000_000}
                step={1}
                value={tolerance}
                onChange={(e) => setTolerance(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">{t("wizard.minorUnitsHint")}</p>
            </div>
            <p className="text-sm text-muted-foreground sm:col-span-2">{t("wizard.currencyHint")}</p>
            <Button className="sm:col-span-2" disabled={busy} onClick={() => void upload("preview")}>
              {busy ? t("wizard.preparing") : t("wizard.preview")}
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
