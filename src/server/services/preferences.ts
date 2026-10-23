import "server-only"
import { cache } from "react"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/db"
import { users } from "@/db/schema"
import { LOCALES, recipientLocale, type Locale, type LocalePreference } from "@/i18n/locale"
import { notFound } from "../errors"

export const getUserLocale = cache(async (userId: string): Promise<LocalePreference> => {
  const [user] = await getDb().select({ locale: users.locale }).from(users).where(eq(users.id, userId))
  return user?.locale ?? null
})

export async function setUserLocale(userId: string, raw: LocalePreference) {
  const locale = z.enum(LOCALES).nullable().parse(raw)
  const updated = await getDb().update(users).set({ locale }).where(eq(users.id, userId)).returning({ id: users.id })
  if (!updated.length) throw notFound()
}

export async function getRecipientLocale(userId: string): Promise<Locale> {
  const [user] = await getDb().select({ locale: users.locale, lastSeenLocale: users.lastSeenLocale }).from(users).where(eq(users.id, userId))
  return recipientLocale(user)
}

export async function rememberBrowserLocale(userId: string, locale: Locale) {
  await getDb().update(users).set({ lastSeenLocale: z.enum(LOCALES).parse(locale) }).where(eq(users.id, userId))
}
