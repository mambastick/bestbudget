"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { connectTelegramAction, disconnectTelegramAction, removePushAction, saveNotificationPreferencesAction, subscribePushAction, testPushAction } from "@/app/actions/notifications"
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
  return Uint8Array.from(atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), (c) => c.charCodeAt(0)).buffer
}
function deviceName(ua: string) {
  const browser = /Firefox/.test(ua) ? "Firefox" : /Edg/.test(ua) ? "Edge" : /Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Браузер"
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : ""
  return `${browser}${os ? ` · ${os}` : ""}`
}
export function NotificationSettings(props: Awaited<ReturnType<typeof notificationProfile>>) {
  const router = useRouter()
  const [p, setP] = useState(props.preferences)
  const [link, setLink] = useState<string | null>(null)
  const [enabling, setEnabling] = useState(false)
  const action = useAction()
  async function enablePush() {
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast.error("Web Push требует HTTPS и поддерживаемый браузер. На iPhone откройте приложение с экрана «Домой».")
      return
    }
    setEnabling(true)
    try {
      if (await Notification.requestPermission() !== "granted") { toast.error("Разрешите уведомления в настройках браузера и повторите."); return }
      await navigator.serviceWorker.register("/sw.js", { scope: "/" })
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const existingKey = subscription.options.applicationServerKey
        if (existingKey && new Uint8Array(existingKey).toString() !== new Uint8Array(applicationKey(props.publicKey)).toString()) {
          await subscription.unsubscribe()
          subscription = null
        }
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(props.publicKey) })
      const json = subscription.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("Invalid subscription")
      action.run(() => subscribePushAction({ endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } }), { success: "Браузер подключён. Включите канал для этой семьи ниже." })
    } catch { toast.error("Не удалось подключить Web Push. Проверьте разрешение браузера и соединение.") }
    finally { setEnabling(false) }
  }
  return (
    <div className="grid grid-cols-1 gap-4">
      <Section title="Каналы уведомлений" description="Подключения общие для профиля. События и каналы включаются отдельно для каждой семьи ниже.">
        <div className="grid grid-cols-1 gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">Telegram: {props.telegramConnected ? "подключён" : props.botReady ? "не подключён" : "бот не настроен"}</span>
            {props.telegramConnected ? <Button variant="outline" disabled={action.pending} onClick={() => action.run(disconnectTelegramAction, { success: "Telegram отключён" })}>Отключить Telegram</Button>
              : <Button variant="outline" disabled={!props.botReady || action.pending} onClick={() => action.run(connectTelegramAction, { onSuccess: (d) => setLink(d.url) })}>Подключить Telegram</Button>}
          </div>
          {link ? <div className="text-sm"><div className="flex flex-wrap gap-2"><LinkButton href={link} target="_blank" rel="noopener noreferrer">Открыть Telegram</LinkButton><Button variant="outline" onClick={() => router.refresh()}>Проверить подключение</Button></div><p className="mt-2 text-muted-foreground">Ссылка одноразовая, действует 10 минут. Нажмите «Запустить» в боте.</p></div> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={enabling || action.pending} onClick={enablePush}>Включить уведомления в браузере</Button>
            <Button variant="outline" disabled={action.pending || !props.devices.length} onClick={() => action.run(testPushAction, { success: "Тест отправлен на подключённые устройства" })}>Тест Web Push</Button>
          </div>
          <p className="text-xs text-muted-foreground">Нужен HTTPS (или localhost). На iPhone/iPad: Safari → «Поделиться» → «На экран Домой», затем откройте приложение оттуда и разрешите уведомления.</p>
          <ul className="divide-y">
            {props.devices.map((d) => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{deviceName(d.userAgent)}</span><Button variant="ghost" size="sm" disabled={action.pending} onClick={() => action.run(() => removePushAction(d.id), { success: "Устройство удалено" })}>Удалить устройство</Button></li>)}
            {!props.devices.length ? <li className="text-sm text-muted-foreground">Подключённых браузеров нет</li> : null}
          </ul>
        </div>
      </Section>
      <Section title="Напоминания для этой семьи" description={`Часовой пояс: ${props.timezone}. Суммы и названия будут видны на экране блокировки и передаваться выбранной службе доставки.`}>
        <form className="grid grid-cols-1 gap-4" onSubmit={(e) => { e.preventDefault(); action.run(() => saveNotificationPreferencesAction(p), { success: "Настройки уведомлений сохранены", onSuccess: setP }) }}>
          <Toggle label="Уведомления в Telegram" checked={p.telegram} onChange={(v) => setP({ ...p, telegram: v })} />
          <Toggle label="Уведомления Web Push" checked={p.push} onChange={(v) => setP({ ...p, push: v })} />
          <Toggle label="Ближайшие платежи" checked={p.due} onChange={(v) => setP({ ...p, due: v })} />
          <Toggle label="Просроченные платежи" checked={p.overdue} onChange={(v) => setP({ ...p, overdue: v })} />
          <Toggle label="Кассовый разрыв" checked={p.cashGap} onChange={(v) => setP({ ...p, cashGap: v })} />
          <Toggle label="Превышение бюджета" checked={p.budget} onChange={(v) => setP({ ...p, budget: v })} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="notice-days">За сколько дней напоминать</FieldLabel><Input id="notice-days" type="number" min={0} max={30} value={p.daysBefore} onChange={(e) => setP({ ...p, daysBefore: Number(e.target.value) })} /></Field>
            <Field><FieldLabel htmlFor="notice-threshold">Порог превышения бюджета, %</FieldLabel><Input id="notice-threshold" type="number" min={0} max={500} value={p.budgetThreshold} onChange={(e) => setP({ ...p, budgetThreshold: Number(e.target.value) })} /></Field>
          </div>
          <Toggle label="Ежедневная сводка вместо отдельных сообщений" checked={p.digest} onChange={(v) => setP({ ...p, digest: v })} />
          <Field><FieldLabel htmlFor="notice-digest">Время сводки</FieldLabel><Input id="notice-digest" type="time" required value={p.digestTime} onChange={(e) => setP({ ...p, digestTime: e.target.value })} /></Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field><FieldLabel htmlFor="notice-quiet-start">Тихие часы с</FieldLabel><Input id="notice-quiet-start" type="time" required value={p.quietStart} onChange={(e) => setP({ ...p, quietStart: e.target.value })} /></Field>
            <Field><FieldLabel htmlFor="notice-quiet-end">Тихие часы до</FieldLabel><Input id="notice-quiet-end" type="time" required value={p.quietEnd} onChange={(e) => setP({ ...p, quietEnd: e.target.value })} /></Field>
          </div>
          <p className="text-xs text-muted-foreground">Одинаковое начало и конец отключают тихие часы. В тихие часы сообщения откладываются. Платёж и просрочка — по одному напоминанию; бюджет — один раз на порог в месяц. Прогноз — на 30 дней.</p>
          <Button type="submit" className="justify-self-start" disabled={action.pending}>Сохранить уведомления</Button>
        </form>
      </Section>
    </div>
  )
}
