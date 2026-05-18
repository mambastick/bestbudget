import {
  CalendarDaysIcon,
  FileTextIcon,
  HomeIcon,
  LandmarkIcon,
  PiggyBankIcon,
  ReceiptTextIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"

import type { View } from "@/domain/types"

export const navItems: Array<{
  view: View
  label: string
  icon: typeof HomeIcon
}> = [
  { view: "overview", label: "Обзор", icon: HomeIcon },
  { view: "transactions", label: "Операции", icon: ReceiptTextIcon },
  { view: "budgets", label: "Бюджеты", icon: PiggyBankIcon },
  { view: "calendar", label: "Календарь", icon: CalendarDaysIcon },
  { view: "liabilities", label: "Кредиты", icon: LandmarkIcon },
  { view: "documents", label: "Документы", icon: FileTextIcon },
  { view: "family", label: "Семья", icon: UsersIcon },
  { view: "settings", label: "Настройки", icon: SettingsIcon },
]
