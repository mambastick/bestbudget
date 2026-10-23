import { eq } from "drizzle-orm"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { closeDb, getDb } from "@/db"
import { users } from "@/db/schema"
import { sendInvitationMail, sendPasswordResetMail } from "@/lib/mail"
import { createUser } from "./helpers"

const smtp = vi.hoisted(() => ({ sendMail: vi.fn().mockResolvedValue({}) }))
vi.mock("nodemailer", () => ({ default: { createTransport: () => smtp } }))
vi.mock("@/lib/env", async (original) => {
  const real = await original<typeof import("@/lib/env")>()
  return { ...real, env: () => ({ ...real.env(), SMTP_URL: "smtp://localhost:2525" }) }
})
beforeEach(() => smtp.sendMail.mockClear())
afterAll(closeDb)

describe("recipient mail language", () => {
  it.each([
    { locale: "ru" as const, lastSeenLocale: "en" as const, subject: "Восстановление доступа к BestBudget" },
    { locale: null, lastSeenLocale: "ru" as const, subject: "Восстановление доступа к BestBudget" },
    { locale: null, lastSeenLocale: null, subject: "Reset your BestBudget password" },
  ])("sends password reset using $locale / $lastSeenLocale", async ({ locale, lastSeenLocale, subject }) => {
    const user = await createUser()
    await getDb().update(users).set({ locale, lastSeenLocale }).where(eq(users.id, user.id))
    await sendPasswordResetMail({ userId: user.id, to: user.email, url: "https://budget.test/reset-password?token=synthetic" })
    expect(smtp.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: user.email, subject, text: expect.stringContaining("https://budget.test/reset-password?token=synthetic") }))
  })

  it("uses the known invitee's language and otherwise the sender's, preserving names", async () => {
    const sender = await createUser()
    const recipient = await createUser()
    await getDb().update(users).set({ locale: "ru" }).where(eq(users.id, sender.id))
    await getDb().update(users).set({ lastSeenLocale: "en" }).where(eq(users.id, recipient.id))
    const input = { senderId: sender.id, sender: "Алексей", household: "Семья Морозовых", url: "https://budget.test/invite/synthetic" }
    await sendInvitationMail({ ...input, to: recipient.email })
    expect(smtp.sendMail).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "You’re invited to BestBudget", text: expect.stringContaining('Алексей invited you to join the “Семья Морозовых” household.') }))
    await sendInvitationMail({ ...input, to: "unknown@example.test" })
    expect(smtp.sendMail).toHaveBeenLastCalledWith(expect.objectContaining({ subject: "Приглашение в BestBudget", text: expect.stringContaining('Алексей приглашает вас') }))
  })
})
