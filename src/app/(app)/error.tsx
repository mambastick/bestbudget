"use client"

import { useTranslations } from "next-intl"

import { RotateCcw, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Error boundary for app pages: the shell stays, the page offers a retry. Details are not shown to users. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("common")
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="mb-3 inline-flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-5" />
      </span>
      <h1 className="text-lg font-semibold">{t("error.couldnTLoadThisPage")}</h1>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {t("error.checkYourConnectionAndTryAgainIfThe")}{" "}{error.digest ? <> {t("error.errorCode")}{" "}<code className="rounded bg-muted px-1">{error.digest}</code></> : null}.
      </p>
      <Button className="mt-5" onClick={reset}>
        <RotateCcw /> {t("error.tryAgain")}{" "}</Button>
    </div>
  )
}
