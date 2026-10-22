export function FxWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null
  const visible = [...warnings].sort((a, b) => Number(b.startsWith("Итоги неполные")) - Number(a.startsWith("Итоги неполные"))).slice(0, 5)
  return (
    <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <p className="font-medium">Курсы валют</p>
      <ul>{visible.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      {warnings.length > visible.length ? <p>Ещё предупреждений: {warnings.length - visible.length}</p> : null}
    </div>
  )
}
