"use client"

import { PwaProvider } from "@/components/app/pwa/pwa-provider"
import { ThemeProvider } from "next-themes"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <PwaProvider>{children}</PwaProvider>
        <Toaster position="top-center" richColors closeButton
          offset={{ top: "calc(1rem + var(--safe-top))", bottom: "calc(1rem + var(--safe-bottom))" }}
          mobileOffset={{ top: "calc(1rem + var(--safe-top))", bottom: "calc(1rem + var(--safe-bottom))" }} />
      </TooltipProvider>
    </ThemeProvider>
  )
}
