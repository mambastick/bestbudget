import { type ReactNode, useRef } from "react"

import { cn } from "@/lib/utils"

export function Magnet({
  children,
  className,
  strength = 10,
}: {
  children: ReactNode
  className?: string
  strength?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return
    }

    const element = ref.current
    if (!element) {
      return
    }

    const rect = element.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * strength
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * strength
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  function handlePointerLeave() {
    if (ref.current) {
      ref.current.style.transform = "translate3d(0, 0, 0)"
    }
  }

  return (
    <div
      ref={ref}
      className={cn("rb-magnet", className)}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {children}
    </div>
  )
}
