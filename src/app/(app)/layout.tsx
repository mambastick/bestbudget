import { householdAiView } from "@/server/ai/access"
import { AppShell } from "@/components/app/app-shell"
import { CatalogProvider } from "@/components/app/operations/catalog-context"
import { OperationsProvider } from "@/components/app/operations/operations-provider"
import { todayIn } from "@/lib/dates"
import { requireHousehold } from "@/server/session"
import { listAccounts, listCategories } from "@/server/services/catalog"
import { listMemberships } from "@/server/services/households"

// Always rendered per request: depends on the session and database.
export const dynamic = "force-dynamic"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireHousehold()
  const [memberships, categories, accounts] = await Promise.all([
    listMemberships(ctx.userId),
    listCategories(ctx, { includeArchived: true }),
    listAccounts(ctx, { includeArchived: true }),
  ])
  const ai = await householdAiView(ctx)
  const catalog = {
    today: todayIn(ctx.timezone),
    currency: ctx.currency,
    role: ctx.role,
    categories: categories.map((c) => ({ id: c.id, kind: c.kind, name: c.name, icon: c.icon, color: c.color, archived: c.archivedAt !== null })),
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, kind: a.kind, currency: a.currency, archived: a.archivedAt !== null })),
  }
  return (
    <CatalogProvider value={catalog}>
      <OperationsProvider>
        <AppShell
          aiEnabled={ai.enabled}
          user={{ name: ctx.user.name, email: ctx.user.email, isAdmin: ctx.user.role === "admin" }}
          households={memberships.map((m) => ({ id: m.id, name: m.name, role: m.role }))}
          activeHouseholdId={ctx.householdId}
        >
          {children}
        </AppShell>
      </OperationsProvider>
    </CatalogProvider>
  )
}
