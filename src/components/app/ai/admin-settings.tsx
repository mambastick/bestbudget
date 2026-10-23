"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { saveAiSettingsAction, testAiConnectionAction, listAiModelsAction } from "@/app/actions/ai"
import { Section } from "@/components/app/settings/section"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { useAction } from "@/hooks/use-action"
import { PROVIDERS, AI_TURN_RESERVATION, type AiProvider } from "@/domain/ai/types"
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
  const locked = config?.source === "env"
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
          list={key === "model" ? "ai-models" : undefined}
          value={value[key]}
          disabled={locked}
          autoComplete="off"
          onChange={(e) => setValue({ ...value, [key]: e.target.value })}
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
            <select
              id="ai-provider"
              className="h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm"
              disabled={locked}
              value={value.provider}
              onChange={(e) => setValue({ ...value, provider: e.target.value as AiProvider, baseUrl: "", model: "" })}
            >
              {[...PROVIDERS, ...(testBuild ? ["mock"] : [])].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          {textField("baseUrl", t("baseUrl"))}
          {textField("apiKey", t("key"), "password")}
          <div className="grid gap-2">
            {textField("model", t("model"))}
            <datalist id="ai-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">{t("manualModel")}</p>
            <Button
              variant="outline"
              disabled={pending || locked}
              onClick={() => run(() => listAiModelsAction(input()), { onSuccess: setModels })}
            >
              {t("loadModels")}
            </Button>
          </div>
          {config?.hasKey ? <p className="text-xs text-muted-foreground">{t("keyStored")}</p> : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={value.clearKey} disabled={locked} onCheckedChange={(checked) => setValue({ ...value, clearKey: checked })} />
            {t("clearKey")}
          </label>
          {textField("temperature", t("temperature"), "number")}
          <div className="grid gap-2">
            <Label htmlFor="ai-limit">{t("limit")}</Label>
            <Input
              id="ai-limit"
              type="number"
              min={0}
              value={value.monthlyTokenLimit}
              disabled={locked}
              onChange={(e) => setValue({ ...value, monthlyTokenLimit: Number(e.target.value) })}
            />
          </div>
          {value.provider === "gigachat" ? (
            <>
              <div className="grid gap-2">
                <Label htmlFor="ai-scope">{t("scope")}</Label>
                <select
                  id="ai-scope"
                  className="h-9 min-w-0 rounded-md border bg-background px-3 text-sm"
                  disabled={locked}
                  value={value.gigachatScope}
                  onChange={(e) => setValue({ ...value, gigachatScope: e.target.value as typeof value.gigachatScope })}
                >
                  {["GIGACHAT_API_PERS", "GIGACHAT_API_B2B", "GIGACHAT_API_CORP"].map((scope) => (
                    <option key={scope}>{scope}</option>
                  ))}
                </select>
              </div>
              {textField("gigachatAuthUrl", t("authUrl"))}
            </>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.selfHosted}
              disabled={locked}
              onCheckedChange={(checked) => setValue({ ...value, selfHosted: checked })}
            />
            {t("selfHosted")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={value.enabled} disabled={locked} onCheckedChange={(checked) => setValue({ ...value, enabled: checked })} />
            {t("enabled")}
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t("quotaHint", { tokens: AI_TURN_RESERVATION })}</p>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={pending} onClick={() => run(() => testAiConnectionAction(input()), { success: t("testOk") })}>
            {t("test")}
          </Button>
          {!locked ? (
            <Button disabled={pending} onClick={() => run(() => saveAiSettingsAction(input()), { success: t("saved") })}>
              {t("save")}
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">{config?.ready ? t("ready") : t("notReady")}</span>
        </div>
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
