import { AiReviewSettings } from "@/components/app/ai/review-settings"
import { getReviewSettings } from "@/server/ai/reviews"
import { AiHouseholdSettings } from "@/components/app/ai/household-settings"
import { householdAiView } from "@/server/ai/access"
import { fingerprint } from "@/server/ai/config"
import { getTranslations } from "next-intl/server"
import type { Metadata } from "next"
import { NotificationSettings } from "@/components/app/settings/notification-settings"
import { CategoriesSettings } from "@/components/app/settings/categories-settings"
import { HouseholdSettings } from "@/components/app/settings/household-settings"
import { ProfileSettings } from "@/components/app/settings/profile-settings"
import { NavTabs } from "@/components/app/nav-tabs"
import { PageHeader } from "@/components/app/page-header"
import { can } from "@/domain/permissions"
import { notificationProfile } from "@/server/notifications/view"
import { requireHousehold } from "@/server/session"
import { listCategories } from "@/server/services/catalog"
import { getHousehold, listInvitations, listMembers } from "@/server/services/households"
import { getAuthMethods } from "@/server/services/settings"
import { getLoginProviders } from "@/server/services/users"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings")
  return { title: t("settings.settings") }
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const t = await getTranslations("settings")
  const TABS = [
    { key: "household", label: t("settings.household") },
    { key: "categories", label: t("settings.categories") },
    { key: "profile", label: t("settings.profileAndSecurity") },
  ] as const

  const ctx = await requireHousehold()
  const requested = (await searchParams).tab
  const tab = TABS.find((t) => t.key === requested)?.key ?? "household"

  let content: React.ReactNode
  if (tab === "household") {
    const [household, members, invitations] = await Promise.all([
      getHousehold(ctx),
      listMembers(ctx),
      can(ctx.role, "invitations.manage") ? listInvitations(ctx) : Promise.resolve([]),
    ])
    const aiView = await householdAiView(ctx)
    const reviewSettings = await getReviewSettings(ctx)
    content = (
      <>
        <HouseholdSettings
          household={{ name: household.name, timezone: household.timezone, currency: household.currency, version: household.version }}
          members={members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() }))}
          invitations={invitations.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() }))}
          currentUserId={ctx.userId}
          role={ctx.role}
        />
        <AiHouseholdSettings view={aiView} providerFingerprint={fingerprint(aiView.provider)} owner={ctx.role === "owner"} />
        <AiReviewSettings key={reviewSettings.version} settings={reviewSettings} enabled={aiView.enabled} canManage={can(ctx.role, "catalog.manage")} timezone={ctx.timezone} />
      </>
    )
  } else if (tab === "categories") {
    const categories = await listCategories(ctx, { includeArchived: true })
    content = (
      <CategoriesSettings
        categories={categories.map((c) => ({ id: c.id, kind: c.kind, name: c.name, icon: c.icon, color: c.color, archived: c.archivedAt !== null }))}
        canManage={can(ctx.role, "catalog.manage")}
      />
    )
  } else {
    const [providers, methods, notifications] = await Promise.all([getLoginProviders(ctx.userId), getAuthMethods(), notificationProfile(ctx)])
    content = (
      <>
        <ProfileSettings
          timeZone={ctx.timezone}
          user={{ name: ctx.user.name, email: ctx.user.email }}
          hasPassword={providers.includes("credential")}
          localEnabled={methods.local}
          sso={methods.oidc ? { name: methods.oidc.displayName, linked: providers.includes("oidc") } : null}
        />
        <NotificationSettings {...notifications} />
      </>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title={t("settings.settings")} />
      <NavTabs tabs={TABS.map((t) => ({ ...t, href: `/settings?tab=${t.key}` }))} active={tab} />
      {content}
    </div>
  )
}
