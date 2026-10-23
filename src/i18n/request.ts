import { cookies, headers } from "next/headers"
import { getRequestConfig } from "next-intl/server"
import { getSession } from "@/server/session"
import { getUserLocale, rememberBrowserLocale } from "@/server/services/preferences"
import { browserLocale, LOCALE_COOKIE, resolveLocale } from "./locale"
import { loadMessages } from "./messages"

export default getRequestConfig(async () => {
  const [jar, h, session] = await Promise.all([cookies(), headers(), getSession()])
  const language = h.get("accept-language")
  if (session && language) await rememberBrowserLocale(session.user.id, browserLocale(language))
  const user = session ? await getUserLocale(session.user.id) : null
  const locale = resolveLocale({ user, cookie: jar.get(LOCALE_COOKIE)?.value, acceptLanguage: h.get("accept-language") })
  return { locale, messages: await loadMessages(locale) }
})
