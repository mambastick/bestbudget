import "server-only"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { cache } from "react"
import { getAuth } from "@/lib/auth"
import type { HouseholdCtx } from "./context"
import { AppError } from "./errors"
import { listMemberships, resolveHouseholdCtx } from "./services/households"

export const HOUSEHOLD_COOKIE = "bb_household"

export const getSession = cache(async () => {
  // Read request headers first: this marks the route dynamic before any database access.
  const h = await headers()
  const auth = await getAuth()
  return auth.api.getSession({ headers: h })
})

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSession>>>["user"]

/** For pages: redirects to the login page when there is no session. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) redirect("/login")
  return session.user
}

export async function requireSystemAdmin(): Promise<SessionUser> {
  const user = await requireUser()
  if (user.role !== "admin") redirect("/dashboard")
  return user
}

/**
 * Resolves the active household from the cookie, always re-checking membership in the database.
 * A forged or stale cookie simply falls back to the user's first household.
 */
export const requireHousehold = cache(async (): Promise<HouseholdCtx & { user: SessionUser }> => {
  const user = await requireUser()
  const preferred = (await cookies()).get(HOUSEHOLD_COOKIE)?.value
  let ctx = preferred ? await resolveHouseholdCtx(user.id, preferred) : null
  if (!ctx) {
    const [first] = await listMemberships(user.id)
    if (!first) redirect("/onboarding")
    ctx = await resolveHouseholdCtx(user.id, first.id)
  }
  if (!ctx) redirect("/onboarding")
  return { ...ctx, user }
})

/** For server actions: same checks, but errors instead of redirects. */
export async function actionUser(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) throw new AppError("session.expired", {}, "unauthorized")
  return session.user
}

export async function actionHousehold(): Promise<HouseholdCtx> {
  const user = await actionUser()
  const preferred = (await cookies()).get(HOUSEHOLD_COOKIE)?.value
  const ctx = preferred ? await resolveHouseholdCtx(user.id, preferred) : null
  if (ctx) return ctx
  const [first] = await listMemberships(user.id)
  const fallback = first ? await resolveHouseholdCtx(user.id, first.id) : null
  if (!fallback) throw new AppError("session.householdForbidden", {}, "forbidden")
  return fallback
}

export async function actionSystemAdmin(): Promise<SessionUser> {
  const user = await actionUser()
  if (user.role !== "admin") throw new AppError("session.adminRequired", {}, "forbidden")
  return user
}
