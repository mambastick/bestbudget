"use server"

import { eq } from "drizzle-orm"
import { cookies, headers } from "next/headers"
import { z } from "zod"
import { getDb } from "@/db"
import { users } from "@/db/schema"
import { allowSignup, getAuth, INVITE_COOKIE } from "@/lib/auth"
import { safeEqual } from "@/lib/crypto"
import { appUrl, env } from "@/lib/env"
import { audit } from "@/server/audit"
import { AppError, runAction } from "@/server/errors"
import { actionUser, HOUSEHOLD_COOKIE } from "@/server/session"
import { acceptInvitation, findValidInvitation } from "@/server/services/households"
import { adminExists } from "@/server/services/users"

const credentials = z.object({
  name: z.string().trim().min(1, "validation.nameRequired").max(80),
  email: z.email("validation.email").trim().toLowerCase(),
  password: z.string().min(10, "validation.passwordLength").max(128),
})

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: appUrl().startsWith("https://"),
  path: "/",
})

/** Creates a local user inside the sign-up gate and starts a session (cookies are set via nextCookies). */
async function signUpLocal(input: z.output<typeof credentials>) {
  const auth = await getAuth()
  const h = await headers()
  try {
    const res = await allowSignup(() => auth.api.signUpEmail({ body: input, headers: h }))
    return res.user
  } catch (err) {
    const code = (err as { body?: { code?: string } }).body?.code
    if (code?.startsWith("USER_ALREADY_EXISTS")) throw new AppError("auth.existingInviteUser")
    if (code === "EMAIL_PASSWORD_DISABLED" || code?.includes("NOT_ENABLED")) throw new AppError("auth.signupDisabled")
    throw err
  }
}

/** First-run setup: creates the system administrator. Requires SETUP_TOKEN from the environment. */
export async function setupAdminAction(input: { token: string; name: string; email: string; password: string }) {
  return runAction(async () => {
    const expected = env().SETUP_TOKEN
    if (!expected) throw new AppError("setup.tokenMissing")
    if (await adminExists()) throw new AppError("setup.alreadyComplete")
    if (!safeEqual(String(input.token ?? ""), expected)) throw new AppError("setup.invalidToken")
    const data = credentials.parse(input)
    const user = await signUpLocal(data)
    await getDb().update(users).set({ role: "admin", emailVerified: true }).where(eq(users.id, user.id))
    await audit({ action: "setup.admin_created", entityType: "user", entityId: user.id, actorId: user.id })
  })
}

/** Registration through an invitation link: creates the account and joins the household atomically from the user's view. */
export async function inviteSignupAction(input: { token: string; name: string; email: string; password: string }) {
  return runAction(async () => {
    const invitation = await findValidInvitation(String(input.token ?? ""))
    if (!invitation) throw new AppError("invite.invalid")
    const user = await signUpLocal(credentials.parse(input))
    const { householdId } = await acceptInvitation(user.id, input.token)
    ;(await cookies()).set(HOUSEHOLD_COOKIE, householdId, { ...cookieOptions(), maxAge: 60 * 60 * 24 * 365 })
  })
}

/** A signed-in user joins the household from an invitation link. */
export async function acceptInviteAction(token: string) {
  return runAction(async () => {
    const user = await actionUser()
    const { householdId } = await acceptInvitation(user.id, token)
    const jar = await cookies()
    jar.set(HOUSEHOLD_COOKIE, householdId, { ...cookieOptions(), maxAge: 60 * 60 * 24 * 365 })
    jar.delete(INVITE_COOKIE)
  })
}

/**
 * Before redirecting to the identity provider with an invitation, remember the token in an HTTP-only cookie:
 * the sign-up hook accepts a new SSO user only with a valid invitation (unless auto-provisioning is on).
 */
export async function prepareSsoInviteAction(token: string) {
  return runAction(async () => {
    if (!(await findValidInvitation(token))) throw new AppError("invite.invalid")
    ;(await cookies()).set(INVITE_COOKIE, token, { ...cookieOptions(), maxAge: 15 * 60 })
  })
}
