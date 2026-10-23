"use client"

import { registerServiceWorker } from "@/lib/pwa/service-worker"

import { useTranslations } from "next-intl"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  connectTelegramAction,
  disconnectTelegramAction,
  removePushAction,
  saveNotificationPreferencesAction,
  subscribePushAction,
  testPushAction,
} from "@/app/actions/notifications"
import { HydratedControls } from "@/components/app/hydrated-controls"
import { Checkbox } from "@/components/ui/checkbox"
import { Toggle } from "@/components/app/admin/auth-settings"
import { LinkButton } from "@/components/app/link-button"
import { Section } from "@/components/app/settings/section"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAction } from "@/hooks/use-action"
import type { notificationProfile } from "@/server/notifications/view"

function applicationKey(key: string): ArrayBuffer {
  const base64 = key.replace(/-/g, "+").replace(/_/g, "/")
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (c) => c.charCodeAt(0)).buffer
}
function deviceName(ua: string, t: (key: string) => string) {
  const browser = /Firefox/.test(ua)
    ? "Firefox"
    : /Edg/.test(ua)
      ? "Edge"
      : /Chrome/.test(ua)
        ? "Chrome"
        : /Safari/.test(ua)
          ? "Safari"
          : t("notification.browser")
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : ""
  return `${browser}${os ? ` · ${os}` : ""}`
}
export function NotificationSettings(props: Awaited<ReturnType<typeof notificationProfile>>) {
  const t = useTranslations("settings")
  const ai = useTranslations("ai.review")
  const router = useRouter()
  const [p, setP] = useState(props.preferences)
  const [link, setLink] = useState<string | null>(null)
  const [enabling, setEnabling] = useState(false)
  const action = useAction()
  async function enablePush() {
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast.error(t("notification.webPushRequiresHttpsAndASupportedBrowser"))
      return
    }
    setEnabling(true)
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        toast.error(t("notification.allowNotificationsInYourBrowserSettingsAndTry"))
        return
      }
      await registerServiceWorker()
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const existingKey = subscription.options.applicationServerKey
        if (
          existingKey &&
          new Uint8Array(existingKey).toString() !== new Uint8Array(applicationKey(props.publicKey)).toString()
        ) {
          await subscription.unsubscribe()
          subscription = null
        }
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationKey(props.publicKey),
      })
      const json = subscription.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("Invalid subscription")
      action.run(
        () =>
          subscribePushAction({
            endpoint: json.endpoint!,
            keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! },
          }),
        { success: t("notification.browserConnectedEnableNotificationsForThisHouseholdBelow") },
      )
    } catch {
      toast.error(t("notification.couldnTEnableWebPushCheckYourBrowser"))
    } finally {
      setEnabling(false)
    }
  }
  return (
    <div className="grid grid-cols-1 gap-4">
      <Section
        title={t("notification.notificationChannels")}
        description={t("notification.connectionsBelongToYourProfileChooseEventsAnd")}
      >
        <div className="grid grid-cols-1 gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">
              Telegram: {props.telegramConnected ? t("notification.connected") : props.botReady ? t("notification.notConnected") : t("notification.botNotConfigured")}
            </span>
            {props.telegramConnected ? (
              <Button
                variant="outline"
                disabled={action.pending}
                onClick={() => action.run(disconnectTelegramAction, { success: t("notification.telegramDisconnected") })}
              >
                {t("notification.disconnectTelegram")}{" "}</Button>
            ) : (
              <Button
                variant="outline"
                disabled={!props.botReady || action.pending}
                onClick={() => action.run(connectTelegramAction, { onSuccess: (d) => setLink(d.url) })}
              >
                {t("notification.connectTelegram")}{" "}</Button>
            )}
          </div>
          {link ? (
            <div className="text-sm">
              <div className="flex flex-wrap gap-2">
                <LinkButton href={link} target="_blank" rel="noopener noreferrer">
                  {t("notification.openTelegram")}{" "}</LinkButton>
                <Button variant="outline" onClick={() => router.refresh()}>
                  {t("notification.checkConnection")}{" "}</Button>
              </div>
              <p className="mt-2 text-muted-foreground">
                {t("notification.thisSingleUseLinkExpiresInMinutesTap")}{" "}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={enabling || action.pending} onClick={enablePush}>
              {t("notification.enableBrowserNotifications")}{" "}</Button>
            <Button
              variant="outline"
              disabled={action.pending || !props.devices.length}
              onClick={() => action.run(testPushAction, { success: t("notification.testSentToConnectedDevices") })}
            >
              {t("notification.testWebPush")}{" "}</Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("notification.httpsOrLocalhostIsRequiredOnIphoneIpad")}{" "}</p>
          <ul className="divide-y">
            {props.devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>{deviceName(d.userAgent, t)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={action.pending}
                  onClick={() => action.run(() => removePushAction(d.id), { success: t("notification.deviceRemoved") })}
                >
                  {t("notification.removeDevice")}{" "}</Button>
              </li>
            ))}
            {!props.devices.length ? (
              <li className="text-sm text-muted-foreground">{t("notification.noBrowsersConnected")}</li>
            ) : null}
          </ul>
        </div>
      </Section>
      <Section
        title={t("notification.remindersForThisHousehold")}
        description={t("notification.timeZoneAmountsAndTitlesMayAppearOn", { timezone: props.timezone })}
      >
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            action.run(() => saveNotificationPreferencesAction(p), {
              success: t("notification.notificationSettingsSaved"),
              onSuccess: setP,
            })
          }}
        >
          <Toggle label={t("notification.telegramNotifications")} checked={p.telegram} onChange={(v) => setP({ ...p, telegram: v })} />
          <Toggle label={t("notification.webPushNotifications")} checked={p.push} onChange={(v) => setP({ ...p, push: v })} />
          <HydratedControls loadingLabel={ai("loading")}>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={p.aiReview} onCheckedChange={(checked) => setP({ ...p, aiReview: checked })} />{ai("personalReview")}</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={p.reviewEmail} onCheckedChange={(checked) => setP({ ...p, reviewEmail: checked })} />{ai("personalEmail")}</label>
            <p className="text-xs text-muted-foreground">{ai("emailHint")}</p>
          </HydratedControls>
          <Toggle label={t("notification.upcomingPayments")} checked={p.due} onChange={(v) => setP({ ...p, due: v })} />
          <Toggle label={t("notification.overduePayments")} checked={p.overdue} onChange={(v) => setP({ ...p, overdue: v })} />
          <Toggle label={t("notification.cashGap")} checked={p.cashGap} onChange={(v) => setP({ ...p, cashGap: v })} />
          <Toggle label={t("notification.budgetOverrun")} checked={p.budget} onChange={(v) => setP({ ...p, budget: v })} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="notice-days">{t("notification.daysBeforePayment")}</FieldLabel>
              <Input
                id="notice-days"
                type="number"
                min={0}
                max={30}
                value={p.daysBefore}
                onChange={(e) => setP({ ...p, daysBefore: Number(e.target.value) })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="notice-threshold">{t("notification.budgetOverrunThreshold")}</FieldLabel>
              <Input
                id="notice-threshold"
                type="number"
                min={0}
                max={500}
                value={p.budgetThreshold}
                onChange={(e) => setP({ ...p, budgetThreshold: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Toggle
            label={t("notification.dailyDigestInsteadOfIndividualMessages")}
            checked={p.digest}
            onChange={(v) => setP({ ...p, digest: v })}
          />
          <Field>
            <FieldLabel htmlFor="notice-digest">{t("notification.digestTime")}</FieldLabel>
            <Input
              id="notice-digest"
              type="time"
              required
              value={p.digestTime}
              onChange={(e) => setP({ ...p, digestTime: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="notice-quiet-start">{t("notification.quietHoursStart")}</FieldLabel>
              <Input
                id="notice-quiet-start"
                type="time"
                required
                value={p.quietStart}
                onChange={(e) => setP({ ...p, quietStart: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="notice-quiet-end">{t("notification.quietHoursEnd")}</FieldLabel>
              <Input
                id="notice-quiet-end"
                type="time"
                required
                value={p.quietEnd}
                onChange={(e) => setP({ ...p, quietEnd: e.target.value })}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("notification.setTheSameStartAndEndTimeTo")}{" "}</p>
          <Button type="submit" className="justify-self-start" disabled={action.pending}>
            {t("notification.saveNotifications")}{" "}</Button>
        </form>
      </Section>
    </div>
  )
}
