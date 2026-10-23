"use client"

import { useTranslations } from "next-intl"

import { LinkButton } from "@/components/app/link-button"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { createHouseholdAction } from "@/app/actions/household"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAction } from "@/hooks/use-action"
import { TimezoneSelect } from "./timezone-select"

export function OnboardingForm({ userName, canCancel }: { userName: string; canCancel: boolean }) {
  const t = useTranslations("onboarding")
  const [name, setName] = useState(t("onboarding.ourHousehold"))
  const [timezone, setTimezone] = useState("Europe/Moscow")
  const { pending, run } = useAction()
  const router = useRouter()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{canCancel ? t("onboarding.newHousehold") : t("onboarding.hello", { userName: userName })}</CardTitle>
        <CardDescription>
          {t("onboarding.aHouseholdIsASharedBudgetWithAccounts")}{" "}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => createHouseholdAction({ name, timezone }), { onSuccess: () => router.replace("/dashboard") })
          }}
        >
          <Field>
            <FieldLabel htmlFor="hh-name">{t("onboarding.name")}</FieldLabel>
            <Input id="hh-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="hh-tz">{t("onboarding.timeZone")}</FieldLabel>
            <TimezoneSelect id="hh-tz" value={timezone} onChange={setTimezone} />
            <p className="text-xs text-muted-foreground">{t("onboarding.determinesTodayForPlannedTransactionsAndForecasts")}</p>
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? t("onboarding.creating") : t("onboarding.create")}
          </Button>
          {canCancel ? (
            <LinkButton variant="ghost" href="/dashboard">
              {t("onboarding.cancel")}{" "}</LinkButton>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}
