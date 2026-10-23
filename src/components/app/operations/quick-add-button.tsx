"use client"

import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { IsoDate } from "@/lib/dates"
import { useOperations } from "./operations-provider"
import type { OperationType } from "./types"

export function QuickAddButton({
  label,
  type,
  date,
  variant = "default",
  size = "default",
}: {
  label?: string
  type?: OperationType
  date?: IsoDate
  variant?: "default" | "outline" | "secondary"
  size?: "default" | "sm"
}) {
  const t = useTranslations("transactions")
  const ops = useOperations()
  return (
    <Button variant={variant} size={size} onClick={() => ops.openCreate({ type, date })}>
      <Plus /> {label ?? t("transaction")}
    </Button>
  )
}
