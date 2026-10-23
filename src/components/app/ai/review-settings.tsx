"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { saveAiReviewSettingsAction } from "@/app/actions/ai-review"
import type { ReviewSettings } from "@/domain/ai/review"
import { useAction } from "@/hooks/use-action"
import { HydratedControls } from "@/components/app/hydrated-controls"
import { LinkButton } from "@/components/app/link-button"
import { Section } from "@/components/app/settings/section"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function AiReviewSettings({
  settings,
  enabled,
  canManage,
  timezone,
}: {
  settings: ReviewSettings
  enabled: boolean
  canManage: boolean
  timezone: string
}) {
  const t = useTranslations("ai.review")
  const [value, setValue] = useState(settings)
  const { run, pending } = useAction()
  return (
    <Section title={t("settingsTitle")} description={t("settingsHint", { timezone })}>
      {!enabled ? (
        <p className="text-sm text-muted-foreground">{t("enableHint")}</p>
      ) : (
        <HydratedControls loadingLabel={t("loading")}>
          <form
            className="grid grid-cols-1 gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              run(() => saveAiReviewSettingsAction(value), { success: t("saved"), onSuccess: setValue })
            }}
          >
            <fieldset disabled={!canManage || pending} className="grid min-w-0 grid-cols-1 gap-4">
              <Field>
                <FieldLabel htmlFor="ai-review-frequency">{t("frequency")}</FieldLabel>
                <select
                  id="ai-review-frequency"
                  className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
                  value={value.frequency}
                  onChange={(e) => setValue({ ...value, frequency: e.target.value as ReviewSettings["frequency"] })}
                >
                  {(["off", "weekly", "monthly"] as const).map((key) => (
                    <option key={key} value={key}>
                      {t(key)}
                    </option>
                  ))}
                </select>
              </Field>
              {value.frequency !== "off" ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {value.frequency === "weekly" ? (
                    <Field>
                      <FieldLabel htmlFor="ai-review-weekday">{t("weekday")}</FieldLabel>
                      <select
                        id="ai-review-weekday"
                        className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
                        value={value.weekday}
                        onChange={(e) => setValue({ ...value, weekday: Number(e.target.value) })}
                      >
                        {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                          <option key={day} value={day}>
                            {t(`weekdays.${day}`)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : (
                    <Field>
                      <FieldLabel htmlFor="ai-review-day">{t("monthDay")}</FieldLabel>
                      <Input
                        id="ai-review-day"
                        type="number"
                        min={1}
                        max={31}
                        required
                        value={value.monthDay}
                        onChange={(e) => setValue({ ...value, monthDay: Number(e.target.value) })}
                      />
                    </Field>
                  )}
                  <Field>
                    <FieldLabel htmlFor="ai-review-time">{t("time")}</FieldLabel>
                    <Input
                      id="ai-review-time"
                      type="time"
                      required
                      value={value.time}
                      onChange={(e) => setValue({ ...value, time: e.target.value })}
                    />
                  </Field>
                </div>
              ) : null}
              <p className="text-sm text-muted-foreground">{t("channelsHint")}</p>
              <div className="flex flex-wrap gap-4">
                {(["telegram", "push", "email"] as const).map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={value[key]} onCheckedChange={(checked) => setValue({ ...value, [key]: checked })} />
                    {t(`channels.${key}`)}
                  </label>
                ))}
              </div>
              {canManage ? (
                <Button type="submit" className="justify-self-start" disabled={pending}>
                  {t("save")}
                </Button>
              ) : null}
            </fieldset>
          </form>
        </HydratedControls>
      )}
      <LinkButton href="/settings?tab=profile" variant="link" className="mt-3 h-auto whitespace-normal p-0 text-left">
        {t("personalNotifications")}
      </LinkButton>
    </Section>
  )
}
