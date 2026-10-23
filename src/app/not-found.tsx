import { useTranslations } from "next-intl"
import { PiggyBank } from "lucide-react"
import { LinkButton } from "@/components/app/link-button"

export default function NotFound() {
  const t = useTranslations("common")
  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <PiggyBank className="size-6" />
      </span>
      <div className="text-5xl font-semibold tracking-tight">404</div>
      <p className="mt-2 text-muted-foreground">{t("notFound.thisPageDoesnTExistTheLinkMay")}</p>
      <LinkButton href="/dashboard" className="mt-6">
        {t("notFound.goToHome")}{" "}</LinkButton>
    </div>
  )
}
