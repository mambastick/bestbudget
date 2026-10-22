import {
  ArrowLeftRight,
  Award,
  Briefcase,
  Bus,
  Car,
  Circle,
  Coffee,
  Dog,
  Dumbbell,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Key,
  Landmark,
  Laptop,
  PartyPopper,
  PiggyBank,
  Plane,
  PlusCircle,
  Repeat,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  TrendingUp,
  Undo2,
  Users,
  Utensils,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  wallet: Wallet,
  award: Award,
  laptop: Laptop,
  "trending-up": TrendingUp,
  gift: Gift,
  undo: Undo2,
  "plus-circle": PlusCircle,
  "shopping-cart": ShoppingCart,
  utensils: Utensils,
  zap: Zap,
  key: Key,
  home: Home,
  landmark: Landmark,
  repeat: Repeat,
  bus: Bus,
  car: Car,
  "heart-pulse": HeartPulse,
  shirt: Shirt,
  "party-popper": PartyPopper,
  "graduation-cap": GraduationCap,
  plane: Plane,
  users: Users,
  circle: Circle,
  coffee: Coffee,
  dog: Dog,
  dumbbell: Dumbbell,
  "piggy-bank": PiggyBank,
  "shopping-bag": ShoppingBag,
  smartphone: Smartphone,
  sparkles: Sparkles,
  wrench: Wrench,
}

export function CategoryIcon({
  icon,
  color,
  transfer,
  className,
}: {
  icon?: string | null
  color?: string | null
  transfer?: boolean
  className?: string
}) {
  const Icon = transfer ? ArrowLeftRight : (CATEGORY_ICONS[icon ?? ""] ?? Circle)
  const c = transfer ? "#64748b" : (color ?? "#64748b")
  return (
    <span
      className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg", className)}
      style={{ backgroundColor: `${c}1f`, color: c }}
      aria-hidden
    >
      <Icon className="size-4" />
    </span>
  )
}
