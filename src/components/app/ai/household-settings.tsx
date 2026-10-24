"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { InterviewStart } from "./interview-start"
import { saveHouseholdAiAction } from "@/app/actions/ai"
import { Section } from "@/components/app/settings/section"
import { Segmented } from "@/components/app/segmented"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { useAction } from "@/hooks/use-action"
import type { DataLevel } from "@/domain/ai/types"
import type { householdAiView } from "@/server/ai/access"

export function AiHouseholdSettings({
  view,
  providerFingerprint,
  owner,
}: {
  view: Awaited<ReturnType<typeof householdAiView>>
  providerFingerprint: string
  owner: boolean
}) {
  const t = useTranslations("ai.consent")
  const [dataLevel, setDataLevel] = useState<DataLevel>(view.dataLevel)
  const [enabled, setEnabled] = useState(view.enabled)
  const [consent, setConsent] = useState(false)
  const { run, pending } = useAction()
  return (
    <Section title={t("title")} description={t("description")}>
      {!view.available ? (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {view.enabled && owner ? <InterviewStart card /> : null}
          <div className="space-y-1 break-words text-sm">
            <p>{t("provider", { provider: view.provider!.provider, model: view.provider!.model })}</p>
            <p className="text-muted-foreground">{t("destination", { url: view.provider!.baseUrl })}</p>
            {view.provider?.selfHosted ? <p>{t("local")}</p> : null}
          </div>
          {!view.consentCurrent && view.version > 0 ? <p className="text-sm text-amber-600 dark:text-amber-400">{t("renew")}</p> : null}
          <Segmented
            value={dataLevel}
            onChange={setDataLevel}
            disabled={!owner}
            options={[
              { value: "aggregates", label: t("aggregates") },
              { value: "detailed", label: t("detailed") },
            ]}
          />
          <p className="text-sm text-muted-foreground">{t("aggregatesHint")}</p>
          {dataLevel === "detailed" ? <p className="text-sm text-muted-foreground">{t("detailedHint")}</p> : null}
          <p className="text-sm text-muted-foreground">{t("messages")}</p>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox className="mt-0.5" checked={enabled} disabled={!owner} onCheckedChange={setEnabled} />
            {t("enabled")}
          </label>
          {enabled ? (
            <label className="flex items-start gap-3 text-sm">
              <Checkbox className="mt-0.5" checked={consent} disabled={!owner} onCheckedChange={setConsent} />
              {t("agree")}
            </label>
          ) : null}
          {owner ? (
            <Button
              className="justify-self-start"
              disabled={pending || (enabled && !consent)}
              onClick={() =>
                run(() => saveHouseholdAiAction({ enabled, dataLevel, consent, providerFingerprint, version: view.version }), {
                  success: t("saved"),
                })
              }
            >
              {t("save")}
            </Button>
          ) : null}
        </div>
      )}
    </Section>
  )
}
