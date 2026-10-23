import type { Metadata, Viewport } from "next"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, getTranslations } from "next-intl/server"
import { cookies } from "next/headers"
import { getSession } from "@/server/session"
import { getUserLocale } from "@/server/services/preferences"
import { isLocale, LOCALE_COOKIE } from "@/i18n/locale"
import { LocalePreferenceProvider } from "@/components/app/preferences"
import { Providers } from "@/components/providers"
import "./globals.css"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common")
  return {
    title: { default: "BestBudget", template: "%s · BestBudget" },
    description: t("appDescription"),
    robots: { index: false, follow: false },
    appleWebApp: { capable: true, title: "BestBudget", statusBarStyle: "default" },
  }
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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const session = await getSession()
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value
  const preference = session ? await getUserLocale(session.user.id) : isLocale(cookie) ? cookie : null
  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          <LocalePreferenceProvider value={preference}>
            <Providers>{children}</Providers>
          </LocalePreferenceProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
