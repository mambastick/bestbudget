"use client"

import { motion } from "motion/react"
import Link from "next/link"
import { useId } from "react"
import { cn } from "@/lib/utils"

/**
 * Page-level tabs that are links (server-rendered sections). Scrolls horizontally on narrow screens
 * without a visible scrollbar; the active underline slides between tabs.
 */
export function NavTabs({ tabs, active }: { tabs: readonly { key: string; label: string; href: string }[]; active: string }) {
  const layoutId = useId()
  return (
    <nav className="no-scrollbar -mx-4 overflow-x-auto overflow-y-hidden px-4 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-1 border-b">
        {tabs.map((t) => {
          const isActive = t.key === active
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative rounded-t-md px-3 pt-2 pb-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                isActive && "text-foreground",
              )}
            >
              {t.label}
              {isActive ? (
                <motion.span
                  layoutId={layoutId}
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              ) : null}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
