import { getLocale, getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { ExchangeRatesSettings } from "@/components/app/admin/exchange-rates"
import { listExchangeRates } from "@/server/services/exchange-rates"
import { todayIn } from "@/lib/dates"
import { NotificationAdmin } from "@/components/app/admin/notification-settings"
import { AuthSettingsForm } from "@/components/app/admin/auth-settings"
import { OidcSettingsForm } from "@/components/app/admin/oidc-settings"
import { UsersTable } from "@/components/app/admin/users-table"
import { NavTabs } from "@/components/app/nav-tabs"
import { PageHeader } from "@/components/app/page-header"
import { Section } from "@/components/app/settings/section"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/lib/dates"
import { env } from "@/lib/env"
import { smtpEnabled } from "@/lib/mail"
import { notificationAdmin } from "@/server/notifications/view"
import { requireHousehold, requireSystemAdmin } from "@/server/session"
import { defaultRedirectUri, getAppSettings, getAuthMethods, getOidcConfig } from "@/server/services/settings"
import { listHouseholdsForAdmin, listSystemEvents, listUsersForAdmin } from "@/server/services/users"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin")
  return { title: t("title") }
}

const tabKeys = ["users", "households", "auth", "rates", "events", "notifications"] as const

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireSystemAdmin()
  const { timezone: timeZone } = await requireHousehold()
  const t = await getTranslations("admin")
  const locale = await getLocale()
  const TABS = tabKeys.map((key) => ({ key, label: t(key) }))
  const EVENT_LABELS: Record<string, string> = {
    "auth.sign_in": t("signedIn"),
    "auth.user_created": t("userCreated"),
    "setup.admin_created": t("firstAdmin"),
    "settings.auth.update": t("authUpdated"),
    "settings.oidc.update": t("oidcUpdated"),
    "admin.user_ban": t("userBanned"),
    "admin.user_unban": t("userUnbanned"),
    "admin.user_role": t("roleUpdated"),
    "admin.user_password_reset": t("passwordReset"),
    "admin.user_sessions_revoked": t("sessionsRevoked"),
    "household.delete": t("householdDeleted"),
    "cli.admin_created": t("cliAdmin"),
    "cli.password_reset": t("cliPassword"),
    "cli.local_auth_enabled": t("cliLocal"),
    "cli.promote": t("cliPromote")
  }

  const requested = (await searchParams).tab
  const tab = TABS.find((t) => t.key === requested)?.key ?? "users"

  let content: React.ReactNode
  if (tab === "users") {
    const users = await listUsersForAdmin()
    content = (
      <UsersTable
        currentUserId={admin.id}
        timeZone={timeZone}
        users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString(), lastSeen: u.lastSeen ? new Date(u.lastSeen).toISOString() : null }))}
      />
    )
  } else if (tab === "households") {
    const households = await listHouseholdsForAdmin()
    content = (
      <Section title={t("householdsTitle")} description={t("householdsHint")}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("owner")}</TableHead>
                <TableHead className="text-right">{t("members")}</TableHead>
                <TableHead>{t("timezone")}</TableHead>
                <TableHead>{t("created")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {households.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="font-medium">{h.name}</TableCell>
                  <TableCell>{h.owner ? `${h.owner.name} (${h.owner.email})` : "—"}</TableCell>
                  <TableCell className="text-right">{h.members}</TableCell>
                  <TableCell>{h.timezone}</TableCell>
                  <TableCell>{formatDateTime(h.createdAt, timeZone, locale)}</TableCell>
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
  } else if (tab === "rates") {
    content = <ExchangeRatesSettings rates={await listExchangeRates()} today={todayIn("Europe/Moscow")} provider={env().FX_PROVIDER} />
  } else if (tab === "notifications") {
    content = <NotificationAdmin {...await notificationAdmin()} timeZone={timeZone} />
  } else {
    const events = await listSystemEvents(200)
    content = (
      <Section title={t("eventsTitle")} description={t("eventsHint")}>
        <ul className="divide-y">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
              <span className="w-36 shrink-0 text-xs text-muted-foreground tabular">{formatDateTime(e.createdAt, timeZone, locale)}</span>
              <span className="min-w-0 flex-1">{EVENT_LABELS[e.action] ?? e.action}</span>
              <span className="text-xs text-muted-foreground">{e.actorEmail ?? t("system")}</span>
            </li>
          ))}
          {events.length === 0 ? <li className="py-6 text-center text-sm text-muted-foreground">{t("noEvents")}</li> : null}
        </ul>
      </Section>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title={t("title")}
        description={
          <>
            {t("manageApp")}<Badge variant="secondary" className="ml-1">{t("systemAdmin")}</Badge>
          </>
        }
      />
      <NavTabs tabs={TABS.map((t) => ({ ...t, href: `/admin?tab=${t.key}` }))} active={tab} />
      {content}
    </div>
  )
}
