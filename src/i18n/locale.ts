export const LOCALES = ["ru", "en"] as const
export type Locale = typeof LOCALES[number]
export type LocalePreference = Locale | null
export const LOCALE_COOKIE = "bb_locale"

export function isLocale(value: unknown): value is Locale {
  return value === "ru" || value === "en"
}

/** Highest quality supported language wins; equal weights retain the browser's order. */
export function browserLocale(acceptLanguage?: string | null): Locale {
  const preferences = (acceptLanguage ?? "").split(",").map((entry, index) => {
    const [tag = "", ...parameters] = entry.trim().split(";")
    const quality = parameters.find((p) => p.trim().startsWith("q="))?.trim().slice(2)
    const q = quality === undefined ? 1 : Number(quality)
    return { language: tag.toLowerCase().split("-")[0], q, index }
  }).filter((p) => Number.isFinite(p.q) && p.q > 0 && p.q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index)
  return preferences.find((p) => isLocale(p.language))?.language as Locale | undefined ?? "en"
}

export function resolveLocale({ user, cookie, acceptLanguage }: {
  user?: unknown; cookie?: unknown; acceptLanguage?: string | null
}): Locale {
  if (isLocale(user)) return user
  if (isLocale(cookie)) return cookie
  return browserLocale(acceptLanguage)
}

/** Background messages never use the locale of the requester or scheduler. */
export function recipientLocale(user?: { locale?: unknown; lastSeenLocale?: unknown } | null): Locale {
  if (isLocale(user?.locale)) return user.locale
  return isLocale(user?.lastSeenLocale) ? user.lastSeenLocale : "en"
}
