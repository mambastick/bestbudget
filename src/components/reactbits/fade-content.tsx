import { type CSSProperties, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export function FadeContent({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <div
      className={cn("rb-fade-content", className)}
      style={{ "--rb-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  )
}
