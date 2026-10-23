"use client"

import { useSyncExternalStore } from "react"
import { FieldSet } from "@/components/ui/field"

const subscribe = () => () => {}

/** Disable SSR controls until React can handle their input and actions. */
export function HydratedControls({ children, loadingLabel }: { children: React.ReactNode; loadingLabel: string }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  return (
    <div aria-busy={!mounted} className="grid min-w-0 grid-cols-1 gap-4">
      {mounted ? null : <p role="status" className="text-sm text-muted-foreground">{loadingLabel}</p>}
      <FieldSet disabled={!mounted} className="min-w-0 gap-6">
        {children}
      </FieldSet>
    </div>
  )
}
