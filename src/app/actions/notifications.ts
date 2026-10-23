"use server"

import { notificationTranslator } from "@/i18n/notifications"
import { getRecipientLocale } from "@/server/services/preferences"
import { randomUUID } from "node:crypto"
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { getDb } from "@/db"
import { pushSubscriptions, telegramLinks } from "@/db/schema"
import type { Preferences } from "@/domain/notifications"
import { AppError, runAction } from "@/server/errors"
import { actionHousehold, actionSystemAdmin, actionUser } from "@/server/session"
import {
  disconnectTelegram,
  removePush,
  savePreferences,
  subscribePush,
  type subscriptionInput,
} from "@/server/services/notifications"
import {
  telegramConfig,
  updateTelegramSettings,
  type telegramSettingsInput,
} from "@/server/services/notification-settings"
import { createTelegramLink } from "@/server/notifications/telegram"
import { sendPushNotice, sendTelegramNotice } from "@/server/notifications/delivery"
import { NOTIFICATION_JOB_LOCK, withJobLock } from "@/server/jobs/lock"
import type { z } from "zod"

const refresh = () => revalidatePath("/", "layout")
export async function saveNotificationPreferencesAction(input: Preferences) {
  return runAction(async () => {
    const result = await savePreferences(await actionHousehold(), input)
    refresh()
    return result
  })
}
export async function connectTelegramAction() {
  return runAction(async () => createTelegramLink((await actionUser()).id))
}
export async function disconnectTelegramAction() {
  return runAction(async () => {
    await disconnectTelegram((await actionUser()).id)
    refresh()
  })
}
export async function subscribePushAction(input: z.input<typeof subscriptionInput>) {
  return runAction(async () => {
    await subscribePush((await actionUser()).id, input, (await headers()).get("user-agent") ?? "")
    refresh()
  })
}
export async function removePushAction(id: string) {
  return runAction(async () => {
    await removePush((await actionUser()).id, id)
    refresh()
  })
}
export async function testPushAction() {
  return runAction(async () => {
    const user = await actionUser()
    const locale = await getRecipientLocale(user.id)
    const t = notificationTranslator(locale)
    const devices = await getDb().select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id))
    if (!devices.length) throw new AppError("notifications.browserRequired")
    for (const device of devices)
      await sendPushNotice(device, {
        kind: "test",
        key: `test:${randomUUID()}`,
        text: t("test"),
        path: "/settings?tab=profile",
      }, locale)
  })
}
export async function updateTelegramSettingsAction(input: z.input<typeof telegramSettingsInput>) {
  return runAction(async () => {
    const admin = await actionSystemAdmin()
    const saved = await withJobLock(NOTIFICATION_JOB_LOCK, async () => {
      await updateTelegramSettings(admin.id, input)
      return true
    })
    if (!saved) throw new AppError("notifications.jobsBusy")
    refresh()
  })
}
export async function testTelegramAction() {
  return runAction(async () => {
    const user = await actionSystemAdmin()
    const locale = await getRecipientLocale(user.id)
    const t = notificationTranslator(locale)
    const [link] = await getDb().select().from(telegramLinks).where(eq(telegramLinks.userId, user.id))
    const c = await telegramConfig()
    if (!c.token || !link?.chatId)
      throw new AppError("notifications.telegramRequired")
    await sendTelegramNotice(c.token, link.chatId, {
      kind: "test",
      key: `test:${randomUUID()}`,
      text: t("test"),
      path: "/settings?tab=profile",
    }, locale)
  })
}
