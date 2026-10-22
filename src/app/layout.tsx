import type { Metadata, Viewport } from "next"
import { Providers } from "@/components/providers"
import "./globals.css"

export const metadata: Metadata = {
  title: { default: "BestBudget", template: "%s · BestBudget" },
  description: "Семейный бюджет: доходы, расходы, регулярные платежи и прогноз остатка",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "BestBudget", statusBarStyle: "default" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#16181d" },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
