import type { Metadata } from "next"
import Link from "next/link"
import { AuthSettingsForm } from "@/components/app/admin/auth-settings"
import { OidcSettingsForm } from "@/components/app/admin/oidc-settings"
import { UsersTable } from "@/components/app/admin/users-table"
import { PageHeader } from "@/components/app/page-header"
import { Section } from "@/components/app/settings/section"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/lib/dates"
import { env } from "@/lib/env"
import { smtpEnabled } from "@/lib/mail"
import { cn } from "@/lib/utils"
import { requireSystemAdmin } from "@/server/session"
import { defaultRedirectUri, getAppSettings, getAuthMethods, getOidcConfig } from "@/server/services/settings"
import { listHouseholdsForAdmin, listSystemEvents, listUsersForAdmin } from "@/server/services/users"

export const metadata: Metadata = { title: "Администрирование" }

const TABS = [
  { key: "users", label: "Пользователи" },
  { key: "households", label: "Пространства" },
  { key: "auth", label: "Авторизация" },
  { key: "events", label: "События" },
] as const

const EVENT_LABELS: Record<string, string> = {
  "auth.sign_in": "Вход в систему",
  "auth.user_created": "Создан пользователь",
  "setup.admin_created": "Создан первый администратор",
  "settings.auth.update": "Изменены способы входа",
  "settings.oidc.update": "Изменены настройки SSO",
  "admin.user_ban": "Пользователь заблокирован",
  "admin.user_unban": "Пользователь разблокирован",
  "admin.user_role": "Изменена роль пользователя",
  "admin.user_password_reset": "Сброшен пароль пользователя",
  "admin.user_sessions_revoked": "Завершены сеансы пользователя",
  "household.delete": "Удалено семейное пространство",
  "cli.admin_created": "Администратор создан из консоли",
  "cli.password_reset": "Пароль сброшен из консоли",
  "cli.local_auth_enabled": "Вход по паролю включён из консоли",
  "cli.promote": "Права администратора выданы из консоли",
}

// Server-only page: the admin needs the system time zone for timestamps.
const TZ = process.env.TZ || "Europe/Moscow"

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireSystemAdmin()
  const requested = (await searchParams).tab
  const tab = TABS.find((t) => t.key === requested)?.key ?? "users"

  let content: React.ReactNode
  if (tab === "users") {
    const users = await listUsersForAdmin()
    content = (
      <UsersTable
        currentUserId={admin.id}
        users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString(), lastSeen: u.lastSeen ? new Date(u.lastSeen).toISOString() : null }))}
      />
    )
  } else if (tab === "households") {
    const households = await listHouseholdsForAdmin()
    content = (
      <Section title="Семейные пространства" description="Администратор приложения видит только метаданные — финансовые данные доступны лишь участникам.">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Владелец</TableHead>
                <TableHead className="text-right">Участников</TableHead>
                <TableHead>Часовой пояс</TableHead>
                <TableHead>Создано</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {households.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">{h.name}</TableCell>
                  <TableCell>{h.owner ? `${h.owner.name} (${h.owner.email})` : "—"}</TableCell>
                  <TableCell className="text-right">{h.members}</TableCell>
                  <TableCell>{h.timezone}</TableCell>
                  <TableCell>{formatDateTime(h.createdAt, TZ)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    )
  } else if (tab === "auth") {
    const [settings, methods, oidc] = await Promise.all([getAppSettings(), getAuthMethods(), getOidcConfig().catch(() => null)])
    content = (
      <div className="grid gap-4 lg:grid-cols-2">
        <AuthSettingsForm
          settings={settings}
          oidcActive={Boolean(methods.oidc)}
          localForced={methods.localForced}
          smtp={smtpEnabled()}
        />
        <OidcSettingsForm
          source={oidc?.source ?? (env().OIDC_ISSUER ? "env" : "db")}
          defaultRedirectUri={defaultRedirectUri()}
          value={
            oidc
              ? {
                  enabled: oidc.enabled,
                  displayName: oidc.displayName,
                  issuerUrl: oidc.issuerUrl,
                  clientId: oidc.clientId,
                  hasSecret: Boolean(oidc.clientSecret),
                  scopes: oidc.scopes.join(" "),
                  redirectUri: oidc.redirectUri === defaultRedirectUri() ? "" : oidc.redirectUri,
                  allowSignup: oidc.allowSignup,
                }
              : null
          }
        />
      </div>
    )
  } else {
    const events = await listSystemEvents(200)
    content = (
      <Section title="Системные события" description="Вход, изменения настроек авторизации и действия администраторов. Секреты не записываются.">
        <ul className="divide-y">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
              <span className="w-36 shrink-0 text-xs text-muted-foreground tabular">{formatDateTime(e.createdAt, TZ)}</span>
              <span className="min-w-0 flex-1">{EVENT_LABELS[e.action] ?? e.action}</span>
              <span className="text-xs text-muted-foreground">{e.actorEmail ?? "система"}</span>
            </li>
          ))}
          {events.length === 0 ? <li className="py-6 text-center text-sm text-muted-foreground">Событий пока нет</li> : null}
        </ul>
      </Section>
    )
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Администрирование"
        description={
          <>
            Управление приложением <Badge variant="secondary" className="ml-1">системный администратор</Badge>
          </>
        }
      />
      <nav className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin?tab=${t.key}`}
            className={cn(
              "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              tab === t.key && "border-primary text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {content}
    </div>
  )
}
