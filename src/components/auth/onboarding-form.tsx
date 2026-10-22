"use client"

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
  const [name, setName] = useState("Наша семья")
  const [timezone, setTimezone] = useState("Europe/Moscow")
  const { pending, run } = useAction()
  const router = useRouter()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{canCancel ? "Новое семейное пространство" : `Здравствуйте, ${userName}!`}</CardTitle>
        <CardDescription>
          Семейное пространство — это общий бюджет: счета, категории, операции и участники. Мы создадим базовые категории и основной счёт, затем
          вы сможете пригласить супруга или супругу.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            run(() => createHouseholdAction({ name, timezone }), { onSuccess: () => router.replace("/dashboard") })
          }}
        >
          <Field>
            <FieldLabel htmlFor="hh-name">Название</FieldLabel>
            <Input id="hh-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="hh-tz">Часовой пояс</FieldLabel>
            <TimezoneSelect id="hh-tz" value={timezone} onChange={setTimezone} />
            <p className="text-xs text-muted-foreground">Определяет «сегодня» для плановых операций и прогноза.</p>
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Создание…" : "Создать"}
          </Button>
          {canCancel ? (
            <LinkButton variant="ghost" href="/dashboard">
              Отмена
            </LinkButton>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}
