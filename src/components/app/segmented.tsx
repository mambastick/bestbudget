"use client"

import { motion } from "motion/react"
import { useId } from "react"
import { cn } from "@/lib/utils"

/**
 * Single-choice segmented control (radio group semantics) with a pill that glides to the active option.
 * Scrolls horizontally instead of squeezing when options do not fit.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "default",
  disabled,
  "aria-label": ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: React.ReactNode }[]
  className?: string
  size?: "sm" | "default"
  disabled?: boolean
  "aria-label"?: string
}) {
  const layoutId = useId()
  return (
    <div className={cn("no-scrollbar max-w-full overflow-x-auto", className)}>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        className={cn("inline-flex w-full min-w-max gap-0.5 rounded-lg bg-muted p-0.5", disabled && "pointer-events-none opacity-60")}
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
          const i = options.findIndex((o) => o.value === value)
          const next = options[(i + (e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length]
          if (next) {
            e.preventDefault()
            onChange(next.value)
            ;(e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus()
          }
        }}
      >
        {options.map((o) => {
          const active = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              data-value={o.value}
              onClick={() => onChange(o.value)}
              className={cn(
                "relative flex-1 rounded-md font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-3.5 text-sm",
                active && "text-foreground",
              )}
            >
              {active ? (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-0 rounded-md bg-background shadow-sm ring-1 ring-foreground/5"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              ) : null}
              <span className="relative">{o.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
