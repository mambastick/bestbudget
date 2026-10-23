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
import { Segmented } from "@/components/app/segmented"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
    <div id="ai-review-settings" className="min-w-0 scroll-mt-6">
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
                  <FieldLabel>{t("frequency")}</FieldLabel>
                  <Segmented
                    aria-label={t("frequency")}
                    size="sm"
                    value={value.frequency}
                    disabled={!canManage || pending}
                    onChange={(frequency) => setValue({ ...value, frequency })}
                    options={(["off", "weekly", "monthly"] as const).map((key) => ({ value: key, label: t(key) }))}
                  />
                </Field>
                {value.frequency !== "off" ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {value.frequency === "weekly" ? (
                      <Field>
                        <FieldLabel htmlFor="ai-review-weekday">{t("weekday")}</FieldLabel>
                        <Select
                          value={String(value.weekday)}
                          disabled={!canManage || pending}
                          items={[1, 2, 3, 4, 5, 6, 7].map((day) => ({ value: String(day), label: t(`weekdays.${day}`) }))}
                          onValueChange={(day) => day && setValue({ ...value, weekday: Number(day) })}
                        >
                          <SelectTrigger id="ai-review-weekday" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                              <SelectItem key={day} value={String(day)}>
                                {t(`weekdays.${day}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
    </div>
  )
}
