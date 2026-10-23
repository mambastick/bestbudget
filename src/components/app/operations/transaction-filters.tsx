"use client"

import { useTranslations } from "next-intl"
import { Download, Search, X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { DateField } from "@/components/app/date-field"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCatalog } from "./catalog-context"

const ALL = "__all"

/** Filters live in the URL so results are server-rendered, shareable and survive reloads. */
export function TransactionFilters() {
  const t = useTranslations("transactions")
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const { categories, accounts, today } = useCatalog()
  const [q, setQ] = useState(params.get("q") ?? "")

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v && v !== ALL) next.set(k, v)
      else next.delete(k)
    }
    next.delete("page")
    router.replace(`${pathname}?${next}`, { scroll: false })
  }

  // Debounced search.
  useEffect(() => {
    if ((params.get("q") ?? "") === q) return
    const t = setTimeout(() => update({ q: q.trim() || null }), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const type = params.get("type") ?? ALL
  const visibleCategories = categories.filter((c) => type === ALL || c.kind === type)
  const active = ["q", "type", "status", "categoryId", "accountId", "from", "to"].some((k) => params.get(k))

  const select = (key: string, placeholder: string, items: { value: string; label: string }[]) => (
    <Select value={params.get(key) ?? ALL} onValueChange={(v) => update({ [key]: v as string })} items={[{ value: ALL, label: placeholder }, ...items]}>
      <SelectTrigger className="w-full sm:w-auto sm:min-w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} className="pl-8" aria-label={t("search")} />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
        {select("type", t("allTypes"), [
          { value: "expense", label: t("expenses") },
          { value: "income", label: t("incomePlural") },
          { value: "transfer", label: t("transfers") },
        ])}
        {select("status", t("actualAndPlanned"), [
          { value: "posted", label: t("postedPlural") },
          { value: "planned", label: t("plannedPlural") },
          { value: "skipped", label: t("skippedPlural") },
        ])}
        {select(
          "categoryId",
          t("allCategories"),
          visibleCategories.map((c) => ({ value: c.id, label: c.archived ? t("archivedName", { name: c.name }) : c.name })),
        )}
        {select(
          "accountId",
          t("allAccounts"),
          accounts.map((a) => ({ value: a.id, label: a.name })),
        )}
        <DateField value={params.get("from")} onChange={(v) => update({ from: v })} today={today} placeholder={t("fromDate")} clearable className="sm:w-44" />
        <DateField value={params.get("to")} onChange={(v) => update({ to: v })} today={today} placeholder={t("toDate")} clearable className="sm:w-44" />
        <a
          href={`/api/export/transactions?${params.toString()}`}
          download
          className={cn(buttonVariants({ variant: "outline" }), "sm:ml-auto")}
        >
          <Download /> {t("exportCsv")}
        </a>
        {active ? (
          <Button
            variant="ghost"
            onClick={() => {
              setQ("")
              router.replace(pathname)
            }}
          >
            <X /> {t("reset")}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
