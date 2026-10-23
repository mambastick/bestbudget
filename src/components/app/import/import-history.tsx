import { useTranslations, useLocale } from "next-intl"
import { formatDateTime } from "@/lib/dates"
import { History } from "lucide-react"
import Link from "next/link"
import { EmptyState } from "@/components/app/empty-state"
import { Section } from "@/components/app/settings/section"
import { PROFILES } from "@/domain/import/profiles"

export function ImportHistory({
  batches,
  timeZone,
}: {
  timeZone: string
  batches: {
    id: string
    source: string
    status: string
    createdAt: string
    counters: { rows: number; created: number; confirmed: number }
  }[]
}) {
  const t = useTranslations("import")
  const locale = useLocale()
  return (
    <Section title={t("history.title")} description={t("history.description")}>
      {batches.length ? (
        <ul className="divide-y">
          {batches.map((b) => (
            <li key={b.id}>
              <Link
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm hover:text-primary"
                href={`/transactions/import?batch=${b.id}`}
              >
                <span className="min-w-0 break-words">
                  {PROFILES.find((p) => p.id === b.source) ? t(PROFILES.find((p) => p.id === b.source)!.name) : t("history.customProfile")}
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTime(b.createdAt, timeZone, locale)} · {t("history.rows", { count: b.counters.rows })}
                  </span>
                </span>
                <span>
                  {b.status === "draft"
                    ? t("history.draft")
                    : b.status === "undone"
                      ? t("history.undone")
                      : t("history.completed", { created: b.counters.created, confirmed: b.counters.confirmed })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={History} title={t("history.emptyTitle")} description={t("history.emptyDescription")} />
      )}
    </Section>
  )
}
