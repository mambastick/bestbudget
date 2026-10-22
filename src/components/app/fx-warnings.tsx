import { LinkButton } from "./link-button"

export function FxWarnings({ warnings, canManageRates = false }: { warnings: string[]; canManageRates?: boolean }) {
  if (!warnings.length) return null
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <div className="grid gap-1">
        <p className="font-medium">Итоги неполные: не хватает курсов валют</p>
        <p>{[...new Set(warnings)].join(" ")}</p>
        {!canManageRates ? <p>Обратитесь к администратору</p> : null}
      </div>
      {canManageRates ? <LinkButton href="/admin?tab=rates" variant="outline" size="sm">Указать курс</LinkButton> : null}
    </div>
  )
}
