"use client"

import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { Sparkles } from "lucide-react"
import { startBudgetInterviewAction } from "@/app/actions/ai"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { HydratedControls } from "@/components/app/hydrated-controls"
import { useAction } from "@/hooks/use-action"

export function InterviewStart({ card = false }: { card?: boolean }) {
  const t = useTranslations("ai.interview"),
    router = useRouter()
  const { pending, run } = useAction()
  const button = (
    <Button
      variant={card ? "default" : "outline"}
      className="h-auto max-w-full whitespace-normal"
      disabled={pending}
      onClick={() =>
        run(startBudgetInterviewAction, {
          onSuccess: ({ id, empty }) => {
            if (empty) sessionStorage.setItem(`ai-draft-${id}`, t("begin"))
            router.push(`/assistant?id=${id}`)
          },
        })
      }
    >
      <Sparkles className="size-4 shrink-0" />
      {card ? t("start") : t("title")}
    </Button>
  )
  return (
    <HydratedControls loadingLabel={t("preparing")}>
      {card ? (
        <Card data-testid="ai-interview-entry">
          <CardHeader>
            <CardTitle>{t("title")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </CardHeader>
          <CardContent>{button}</CardContent>
        </Card>
      ) : (
        button
      )}
    </HydratedControls>
  )
}
