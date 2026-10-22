import { NextResponse } from "next/server"
import { z } from "zod"
import { appUrl } from "@/lib/env"
import { HOUSEHOLD_COOKIE, requireUser } from "@/server/session"
import { resolveHouseholdCtx } from "@/server/services/households"

/** A deliberate notification click selects the household after checking the current session's membership. */
export async function GET(request: Request) {
  const user = await requireUser()
  const url = new URL(request.url)
  const id = z.uuid().safeParse(url.searchParams.get("household"))
  if (!id.success || !await resolveHouseholdCtx(user.id, id.data)) return NextResponse.redirect(`${appUrl()}/dashboard`)
  const page = url.searchParams.get("page") ?? "/dashboard"
  const allowed = ["/dashboard", "/transactions", "/calendar", "/budgets"]
  const response = NextResponse.redirect(`${appUrl()}${allowed.includes(page) ? page : "/dashboard"}`)
  response.cookies.set(HOUSEHOLD_COOKIE, id.data, { httpOnly: true, sameSite: "lax", secure: appUrl().startsWith("https://"), path: "/", maxAge: 60 * 60 * 24 * 365 })
  return response
}
