import { type ReactNode } from "react"

import { cn } from "@/lib/utils"

export function AnimatedList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn("rb-animated-list", className)}>{children}</div>
}
