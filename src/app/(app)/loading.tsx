import { useTranslations } from "next-intl"
import { Skeleton } from "@/components/ui/skeleton"

/** Shown while a page's server data loads (navigation between sections). */
export default function Loading() {
  const t = useTranslations("common")
  return (
    <div className="grid grid-cols-1 gap-6" aria-busy="true" aria-label={t("loading.loading")}>
      <div className="grid gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  )
}
