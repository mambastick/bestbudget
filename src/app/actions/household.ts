"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import type { HouseholdRole } from "@/domain/permissions"
import { appUrl } from "@/lib/env"
import { forbidden, runAction } from "@/server/errors"
import { actionHousehold, actionUser, HOUSEHOLD_COOKIE } from "@/server/session"
import * as households from "@/server/services/households"

const refresh = () => revalidatePath("/", "layout")

async function setActiveHousehold(id: string) {
  ;(await cookies()).set(HOUSEHOLD_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: appUrl().startsWith("https://"),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
}

export async function createHouseholdAction(input: { name: string; timezone?: string }) {
  return runAction(async () => {
    const user = await actionUser()
    const household = await households.createHousehold(user.id, input)
    await setActiveHousehold(household.id)
    refresh()
  })
}

export async function switchHouseholdAction(id: string) {
  return runAction(async () => {
    const user = await actionUser()
    const ctx = await households.resolveHouseholdCtx(user.id, id)
    if (!ctx) throw forbidden()
    await setActiveHousehold(id)
    refresh()
  })
}

export async function updateHouseholdAction(input: { name: string; timezone: string }) {
  return runAction(async () => {
    await households.updateHousehold(await actionHousehold(), input)
    refresh()
  })
}

export async function deleteHouseholdAction(confirmName: string) {
  return runAction(async () => {
    await households.deleteHousehold(await actionHousehold(), confirmName)
    ;(await cookies()).delete(HOUSEHOLD_COOKIE)
    refresh()
  })
}

export async function createInvitationAction(input: { role: "admin" | "member"; note?: string; ttlDays?: number }) {
  return runAction(async () => {
    const inv = await households.createInvitation(await actionHousehold(), input)
    refresh()
    return { url: `${appUrl()}/invite/${inv.token}`, expiresAt: inv.expiresAt.toISOString() }
  })
}

export async function revokeInvitationAction(id: string) {
  return runAction(async () => {
    await households.revokeInvitation(await actionHousehold(), id)
    refresh()
  })
}

export async function changeMemberRoleAction(userId: string, role: HouseholdRole) {
  return runAction(async () => {
    await households.changeMemberRole(await actionHousehold(), userId, role)
    refresh()
  })
}

export async function transferOwnershipAction(userId: string) {
  return runAction(async () => {
    await households.transferOwnership(await actionHousehold(), userId)
    refresh()
  })
}

export async function removeMemberAction(userId: string) {
  return runAction(async () => {
    await households.removeMember(await actionHousehold(), userId)
    refresh()
  })
}

export async function leaveHouseholdAction() {
  return runAction(async () => {
    const ctx = await actionHousehold()
    await households.removeMember(ctx, ctx.userId)
    ;(await cookies()).delete(HOUSEHOLD_COOKIE)
    refresh()
  })
}
