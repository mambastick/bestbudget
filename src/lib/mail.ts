import "server-only"
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
