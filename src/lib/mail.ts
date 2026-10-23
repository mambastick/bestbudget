import "server-only"
import { eq } from "drizzle-orm"
import { createTranslator } from "use-intl/core"
import { getDb } from "@/db"
import { users } from "@/db/schema"
import { getRecipientLocale } from "@/server/services/preferences"
import { recipientLocale, type Locale } from "@/i18n/locale"
import en from "../../messages/en/mail.json"
import ru from "../../messages/ru/mail.json"
import nodemailer, { type Transporter } from "nodemailer"
import { env } from "./env"

let transporter: Transporter | undefined

/** E-mail is optional: without SMTP the app works fully, password resets are done by an administrator. */
export function smtpEnabled() {
  return Boolean(env().SMTP_URL)
}

export async function sendMail(message: { to: string; subject: string; text: string }) {
  const { SMTP_URL, SMTP_FROM } = env()
  if (!SMTP_URL) throw new Error("SMTP is not configured")
  transporter ??= nodemailer.createTransport(SMTP_URL)
  await transporter.sendMail({ from: SMTP_FROM ?? "BestBudget <no-reply@localhost>", ...message })
}

export function mailTranslator(locale: Locale) {
  return createTranslator({ locale, messages: locale === "ru" ? ru : en })
}

export async function sendPasswordResetMail(input: { userId: string; to: string; url: string }) {
  const t = mailTranslator(await getRecipientLocale(input.userId))
  await sendMail({ to: input.to, subject: t("resetSubject"), text: t("resetBody", { url: input.url }) })
}

/** Invitations currently use shareable links; this helper also supports callers with an e-mail recipient. */
export async function sendInvitationMail(input: { to: string; senderId: string; sender: string; household: string; url: string }) {
  const [recipient] = await getDb().select({ locale: users.locale, lastSeenLocale: users.lastSeenLocale }).from(users).where(eq(users.email, input.to.trim().toLowerCase()))
  const locale = recipient ? recipientLocale(recipient) : await getRecipientLocale(input.senderId)
  const t = mailTranslator(locale)
  await sendMail({ to: input.to, subject: t("inviteSubject"), text: t("inviteBody", { sender: input.sender, household: input.household, url: input.url }) })
}
