"use server"

import { cookies, headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { browserLocale, LOCALES, LOCALE_COOKIE, type LocalePreference } from "@/i18n/locale"
import { appUrl } from "@/lib/env"
import { runAction } from "@/server/errors"
import { getSession } from "@/server/session"
import { rememberBrowserLocale, setUserLocale } from "@/server/services/preferences"

export async function setLocaleAction(raw: LocalePreference) {
  return runAction(async () => {
    const locale = z.enum(LOCALES).nullable().parse(raw)
    const session = await getSession()
    if (session) {
      await setUserLocale(session.user.id, locale)
      await rememberBrowserLocale(session.user.id, browserLocale((await headers()).get("accept-language")))
    }
    const jar = await cookies()
    if (locale === null) jar.delete(LOCALE_COOKIE)
    else jar.set(LOCALE_COOKIE, locale, {
      httpOnly: true, sameSite: "lax", secure: appUrl().startsWith("https://"), path: "/", maxAge: 60 * 60 * 24 * 365,
    })
    revalidatePath("/", "layout")
  })
}
