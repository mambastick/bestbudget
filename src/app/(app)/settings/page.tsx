import type { Metadata } from "next"
import Link from "next/link"
import { CategoriesSettings } from "@/components/app/settings/categories-settings"
import { HouseholdSettings } from "@/components/app/settings/household-settings"
import { ProfileSettings } from "@/components/app/settings/profile-settings"
import { PageHeader } from "@/components/app/page-header"
import { can } from "@/domain/permissions"
import { cn } from "@/lib/utils"
import { requireHousehold } from "@/server/session"
import { listCategories } from "@/server/services/catalog"
import { getHousehold, listInvitations, listMembers } from "@/server/services/households"
import { getAuthMethods } from "@/server/services/settings"
import { getLoginProviders } from "@/server/services/users"

export const metadata: Metadata = { title: "Настройки" }

const TABS = [
  { key: "household", label: "Семья" },
  { key: "categories", label: "Категории" },
  { key: "profile", label: "Профиль и безопасность" },
] as const

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
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
    content = (
      <HouseholdSettings
        household={{ name: household.name, timezone: household.timezone, currency: household.currency }}
        members={members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() }))}
        invitations={invitations.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() }))}
        currentUserId={ctx.userId}
        role={ctx.role}
      />
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
    const [providers, methods] = await Promise.all([getLoginProviders(ctx.userId), getAuthMethods()])
    content = (
      <ProfileSettings
        user={{ name: ctx.user.name, email: ctx.user.email }}
        hasPassword={providers.includes("credential")}
        localEnabled={methods.local}
        sso={methods.oidc ? { name: methods.oidc.displayName, linked: providers.includes("oidc") } : null}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Настройки" />
      <nav className="flex gap-1 overflow-x-auto border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/settings?tab=${t.key}`}
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
