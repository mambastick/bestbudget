import { History } from "lucide-react"
import Link from "next/link"
import { EmptyState } from "@/components/app/empty-state"
import { Section } from "@/components/app/settings/section"
import { PROFILES } from "@/domain/import/profiles"

export function ImportHistory({
  batches,
}: {
  batches: {
    id: string
    source: string
    status: string
    createdAt: string
    counters: { rows: number; created: number; confirmed: number }
  }[]
}) {
  return (
    <Section title="История импортов" description="Последние 100 партий. Черновик можно открыть снова и продолжить.">
      {batches.length ? (
        <ul className="divide-y">
          {batches.map((b) => (
            <li key={b.id}>
              <Link
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm hover:text-primary"
                href={`/transactions/import?batch=${b.id}`}
              >
                <span className="min-w-0 break-words">
                  {PROFILES.find((p) => p.id === b.source)?.name ?? "Пользовательский профиль"}
                  <span className="block text-xs text-muted-foreground">
                    {b.createdAt.slice(0, 10)} · строк: {b.counters.rows}
                  </span>
                </span>
                <span>
                  {b.status === "draft"
                    ? "Черновик"
                    : b.status === "undone"
                      ? "Отменён"
                      : `Готово · создано ${b.counters.created}, плановых ${b.counters.confirmed}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={History} title="Импортов пока нет" description="Выберите файл, проверьте предпросмотр и подтвердите запись." />
      )}
    </Section>
  )
}
