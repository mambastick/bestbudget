"use client"

import { createContext, useContext } from "react"
import type { HouseholdRole } from "@/domain/permissions"
import type { IsoDate } from "@/lib/dates"

export interface CatalogCategory {
  id: string
  kind: "income" | "expense"
  name: string
  icon: string
  color: string
  archived: boolean
}

export interface CatalogAccount {
  id: string
  name: string
  kind: string
  archived: boolean
}

export interface Catalog {
  today: IsoDate
  currency: string
  role: HouseholdRole
  categories: CatalogCategory[]
  accounts: CatalogAccount[]
}

const CatalogContext = createContext<Catalog | null>(null)

export function CatalogProvider({ value, children }: { value: Catalog; children: React.ReactNode }) {
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog(): Catalog {
  const ctx = useContext(CatalogContext)
  if (!ctx) throw new Error("useCatalog must be used inside CatalogProvider")
  return ctx
}
