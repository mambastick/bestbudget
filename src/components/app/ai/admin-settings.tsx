"use client"

import { useState } from "react"
import { useTranslations, useFormatter } from "next-intl"
import { saveAiSettingsAction, testAiConnectionAction, listAiModelsAction } from "@/app/actions/ai"
import { Section } from "@/components/app/settings/section"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { useAction } from "@/hooks/use-action"
import { AI_PRESETS, presetFor } from "@/domain/ai/presets"
import type { AiDiagnostic } from "@/domain/ai/diagnostics"
import type { ActionResult } from "@/server/errors"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ModelPicker } from "./model-picker"
import { AI_TURN_RESERVATION, type AiProvider } from "@/domain/ai/types"
import type { publicAiConfig } from "@/server/ai/config"
import type { monthlyUsage } from "@/server/ai/conversations"

export function AiAdminSettings({
  config,
  usage,
  testBuild,
}: {
  config: Awaited<ReturnType<typeof publicAiConfig>>
  usage: Awaited<ReturnType<typeof monthlyUsage>>
  testBuild: boolean
}) {
  const t = useTranslations("ai.admin")
  const errors = useTranslations("errors")
  const format = useFormatter()
  const [diagnostic, setDiagnostic] = useState<AiDiagnostic | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [preset, setPreset] = useState(presetFor(config?.provider ?? "openai", config?.baseUrl ?? "https://api.openai.com/v1"))
  const { pending, run } = useAction()
  const [value, setValue] = useState({
    provider: config?.provider ?? ("openai" as AiProvider),
    baseUrl: config?.baseUrl ?? "",
    apiKey: "",
    clearKey: false,
    model: config?.model ?? "",
    temperature: config?.temperature === null || config?.temperature === undefined ? "" : String(config.temperature),
    monthlyTokenLimit: config?.monthlyTokenLimit ?? 0,
    enabled: config?.enabled ?? false,
    selfHosted: config?.selfHosted ?? false,
    gigachatScope: config?.gigachatScope ?? "GIGACHAT_API_PERS",
    gigachatAuthUrl: config?.gigachatAuthUrl ?? "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
  })
  const [models, setModels] = useState<string[]>([])
  const presets = AI_PRESETS.filter((p) => testBuild || p.id !== "mock").map((p) => ({ ...p, value: p.id, label: p.id === "custom" ? t("customProvider") : p.label }))
  async function diagnose<T>(action: () => Promise<ActionResult<T>>) {
    const result = await action()
    setDiagnostic(result.ok ? null : result.diagnostic ?? null)
    setFailure(result.ok ? null : result.error)
    return result
  }
  const locked = config?.source === "env"
  const displayedError = failure ? diagnostic : config?.lastError
  const input = () => ({
    ...value,
    version: config?.version ?? 0,
    temperature: value.temperature === "" ? null : Number(value.temperature),
  })
  function textField(key: "baseUrl" | "apiKey" | "model" | "temperature" | "gigachatAuthUrl", label: string, type = "text") {
    return (
      <div className="grid gap-2">
        <Label htmlFor={`ai-${key}`}>{label}</Label>
        <Input
          id={`ai-${key}`}
          type={type}
          value={value[key]}
          disabled={pending || locked || (key === "apiKey" && value.clearKey)}
          aria-describedby={key === "apiKey" ? "ai-key-hint" : undefined}
          autoComplete="off"
          onChange={(e) => {
            if (key === "baseUrl") setPreset(presetFor(value.provider, e.target.value))
            setValue({ ...value, [key]: e.target.value, ...(key === "apiKey" && e.target.value.trim() ? { clearKey: false } : {}) })
          }}
        />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-4">
      <Section title={t("title")} description={t("description")}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {locked ? <p className="text-sm text-muted-foreground sm:col-span-2">{t("env")}</p> : null}
          <div className="grid gap-2">
            <Label htmlFor="ai-provider">{t("provider")}</Label>
            <Select disabled={pending || locked} value={preset} items={presets} onValueChange={(id) => {
              const next = presets.find((p) => p.id === id)
              if (!next) return
              setPreset(next.id)
              setModels([])
              setValue({ ...value, provider: next.provider, baseUrl: next.baseUrl, model: "", selfHosted: "selfHosted" in next && next.selfHosted === true })
            }}>
              <SelectTrigger id="ai-provider" className="w-full min-w-0"><SelectValue /></SelectTrigger>
              <SelectContent>{presets.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {textField("baseUrl", t("baseUrl"))}
          <div className="grid content-start gap-2">
            {textField("apiKey", t("key"), "password")}
            <p id="ai-key-hint" className="text-xs text-muted-foreground">
              {value.clearKey ? t("keyRemovalHint") : config?.hasKey ? t("keyStored", { suffix: config.keyLast4 }) : t("keyMissing")}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={value.clearKey} disabled={pending || locked} onCheckedChange={(checked) => setValue({ ...value, clearKey: checked, ...(checked ? { apiKey: "" } : {}) })} />
              {t("clearKey")}
            </label>
          </div>
          <div className="grid gap-2">
            {textField("model", t("model"))}
            {models.length ? <ModelPicker disabled={pending || locked} models={models} onChange={(model) => setValue({ ...value, model })} /> : null}
            <p className="text-xs text-muted-foreground">{t("manualModel")}</p>
            <Button
              variant="outline"
              disabled={pending || locked}
              onClick={() => run(() => diagnose(() => listAiModelsAction(input())), { onSuccess: setModels })}
            >
              {t("loadModels")}
            </Button>
          </div>
          {textField("temperature", t("temperature"), "number")}
          <div className="grid gap-2">
            <Label htmlFor="ai-limit">{t("limit")}</Label>
            <Input
              id="ai-limit"
              type="number"
              min={0}
              value={value.monthlyTokenLimit}
              disabled={pending || locked}
              onChange={(e) => setValue({ ...value, monthlyTokenLimit: Number(e.target.value) })}
            />
          </div>
          {value.provider === "gigachat" ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="ai-scope">{t("scope")}</Label>
                <Select disabled={pending || locked} value={value.gigachatScope}
                  items={["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"].map((scope) => ({ value: scope, label: scope }))}
                  onValueChange={(scope) => scope && setValue({ ...value, gigachatScope: scope as typeof value.gigachatScope })}>
                  <SelectTrigger id="ai-scope" className="w-full min-w-0"><SelectValue /></SelectTrigger>
                  <SelectContent>{["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"].map((scope) => <SelectItem key={scope} value={scope}>{scope}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {textField("gigachatAuthUrl", t("authUrl"))}
            </>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.selfHosted}
              disabled={pending || locked}
              onCheckedChange={(checked) => setValue({ ...value, selfHosted: checked })}
            />
            {t("selfHosted")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={value.enabled} disabled={pending || locked} onCheckedChange={(checked) => setValue({ ...value, enabled: checked })} />
            {t("enabled")}
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("quotaHint", { tokens: AI_TURN_RESERVATION })}</p>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={pending} onClick={() => run(() => diagnose(() => testAiConnectionAction(input())), { success: t("testOk") })}>
            {t("test")}
          </Button>
          {!locked ? (
            <Button disabled={pending} onClick={() => run(() => diagnose(() => saveAiSettingsAction(input())), { success: t("saved"), onSuccess: () => setValue({ ...value, apiKey: "", clearKey: false }) })}>
              {t("save")}
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">{config?.ready ? t("ready") : t("notReady")}</span>
        </div>
        {failure || config?.lastError ? (
          <div role="alert" className="mt-4 min-w-0 space-y-2 rounded-lg border border-destructive/30 p-3 text-sm wrap-anywhere">
            <p>{failure ?? (config?.lastError ? errors(config.lastError.code) : "")}</p>
            {config?.lastError?.at && (!failure || diagnostic) ? <p className="text-xs text-muted-foreground">{t("lastError", { time: format.dateTime(new Date(config.lastError.at), { dateStyle: "short", timeStyle: "short" }) })}</p> : null}
            {displayedError ? <details>
              <summary className="cursor-pointer">{t("details")}</summary>
              <p className="mt-2">{displayedError.status ? `HTTP ${displayedError.status}` : t("noHttpStatus")}</p>
              {diagnostic?.message ? <p className="mt-1 whitespace-pre-wrap">{diagnostic.message}</p> : null}
            </details> : null}
          </div>
        ) : null}
      </Section>
      <Section title={t("usage")} description={t("tokens")}>
        <ul className="divide-y">
          {usage.map((u) => (
            <li key={u.householdId} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
              <span>{u.name}</span>
              <span className="tabular-nums">
                {u.input} / {u.output} / {u.reserved}
              </span>
            </li>
          ))}
        </ul>
        {!usage.length ? <p className="text-sm text-muted-foreground">{t("noUsage")}</p> : null}
      </Section>
    </div>
  )
}
