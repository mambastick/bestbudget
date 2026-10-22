"use client"

import { useTheme } from "next-themes"
import SpotlightCard from "@/components/reactbits/SpotlightCard"
import { cn } from "@/lib/utils"

/** The dashboard's lead card: a soft spotlight follows the pointer (React Bits SpotlightCard), in the app's colors. */
export function BalanceHero({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  const { resolvedTheme } = useTheme()
  return (
    <SpotlightCard
      data-testid="actual-balance"
      title={title}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      spotlightColor="var(--primary)"
      intensity={0.22}
      spotlightSize={320}
      borderGlow={0.8}
      className={cn("flex flex-col gap-0 rounded-xl p-0 text-sm text-card-foreground", className)}
      style={
        {
          "--spotlight-card-surface": "var(--card)",
          "--spotlight-card-border": "color-mix(in oklab, var(--foreground) 10%, transparent)",
          "--spotlight-card-shadow": "none",
        } as React.CSSProperties
      }
    >
      {children}
    </SpotlightCard>
  )
}
