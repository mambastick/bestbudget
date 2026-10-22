"use server"

import { randomBytes } from "node:crypto"
import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { getAuth, invalidateAuth } from "@/lib/auth"
import { audit } from "@/server/audit"
import { AppError, runAction } from "@/server/errors"
import { actionSystemAdmin } from "@/server/session"
import * as settings from "@/server/services/settings"
import { countAdmins } from "@/server/services/users"

const refresh = () => revalidatePath("/", "layout")

export async function updateAuthSettingsAction(input: Parameters<typeof settings.updateAuthSettings>[1]) {
  return runAction(async () => {
    const admin = await actionSystemAdmin()
    await settings.updateAuthSettings(admin.id, input)
    invalidateAuth()
    refresh()
  })
}

export async function updateOidcSettingsAction(input: Parameters<typeof settings.updateOidcSettings>[1]) {
  return runAction(async () => {
    const admin = await actionSystemAdmin()
    await settings.updateOidcSettings(admin.id, input)
    invalidateAuth()
    refresh()
  })
}

export async function testOidcDiscoveryAction(issuerUrl: string) {
  return runAction(async () => {
    await actionSystemAdmin()
    try {
      return await settings.testOidcDiscovery(issuerUrl)
    } catch (err) {
      if (err instanceof AppError) throw err
      throw new AppError("Не удалось получить discovery-документ провайдера. Проверьте Issuer URL и доступность сервера.")
    }
  })
}

export async function setUserBannedAction(userId: string, banned: boolean) {
  return runAction(async () => {
    const admin = await actionSystemAdmin()
    if (userId === admin.id) throw new AppError("Нельзя заблокировать самого себя")
    const auth = await getAuth()
    const h = await headers()
    if (banned) await auth.api.banUser({ body: { userId, banReason: "Заблокирован администратором" }, headers: h })
    else await auth.api.unbanUser({ body: { userId }, headers: h })
    await audit({ action: banned ? "admin.user_ban" : "admin.user_unban", entityType: "user", entityId: userId, actorId: admin.id })
    refresh()
  })
}

export async function setUserRoleAction(userId: string, role: "admin" | "user") {
  return runAction(async () => {
    const admin = await actionSystemAdmin()
    if (userId === admin.id && role !== "admin" && (await countAdmins()) <= 1) {
      throw new AppError("Нельзя снять права с последнего администратора")
    }
    const auth = await getAuth()
    await auth.api.setRole({ body: { userId, role }, headers: await headers() })
    await audit({ action: "admin.user_role", entityType: "user", entityId: userId, actorId: admin.id, meta: { role } })
    refresh()
  })
}

/** Sets a random temporary password and signs the user out everywhere. The password is shown to the admin once. */
export async function resetUserPasswordAction(userId: string) {
  return runAction(async () => {
    const admin = await actionSystemAdmin()
    const auth = await getAuth()
    const h = await headers()
    const password = randomBytes(9).toString("base64url")
    try {
      await auth.api.setUserPassword({ body: { userId, newPassword: password }, headers: h })
    } catch {
      throw new AppError("У пользователя нет входа по паролю (только SSO)")
    }
    await auth.api.revokeUserSessions({ body: { userId }, headers: h })
    await audit({ action: "admin.user_password_reset", entityType: "user", entityId: userId, actorId: admin.id })
    return { password }
  })
}

export async function revokeUserSessionsAction(userId: string) {
  return runAction(async () => {
    const admin = await actionSystemAdmin()
    const auth = await getAuth()
    await auth.api.revokeUserSessions({ body: { userId }, headers: await headers() })
    await audit({ action: "admin.user_sessions_revoked", entityType: "user", entityId: userId, actorId: admin.id })
    refresh()
  })
}
