import { cookies, headers } from "next/headers"
import { getRequestConfig } from "next-intl/server"
import { getSession } from "@/server/session"
import { getUserLocale } from "@/server/services/preferences"
import { LOCALE_COOKIE, resolveLocale } from "./locale"
import { loadMessages } from "./messages"

export default getRequestConfig(async () => {
  const [jar, h, session] = await Promise.all([cookies(), headers(), getSession()])
  const user = session ? await getUserLocale(session.user.id) : null
  const locale = resolveLocale({ user, cookie: jar.get(LOCALE_COOKIE)?.value, acceptLanguage: h.get("accept-language") })
  return { locale, messages: await loadMessages(locale) }
})
