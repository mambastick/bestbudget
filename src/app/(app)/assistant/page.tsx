import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { NavTabs } from "@/components/app/nav-tabs"
import { AiChat } from "@/components/app/ai/chat"
import { PageHeader } from "@/components/app/page-header"
import { requireHousehold } from "@/server/session"
import { householdAiView } from "@/server/ai/access"
import { conversationMessages, getConversation, listConversations } from "@/server/ai/conversations"
import { listProposals } from "@/server/ai/proposals"
import { listAccounts, listCategories } from "@/server/services/catalog"

export async function generateMetadata() {
  return { title: (await getTranslations("ai"))("title") }
}
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const ctx = await requireHousehold(),
    view = await householdAiView(ctx),
    t = await getTranslations("ai")
  if (!view.enabled) notFound()
  const id = (await searchParams).id
  if (id) await getConversation(ctx, id)
  const [conversations, messages, proposals, accounts, categories] = await Promise.all([
    listConversations(ctx),
    id ? conversationMessages(ctx, id) : [],
    id ? listProposals(ctx, id) : [],
    listAccounts(ctx, { includeArchived: true }),
    listCategories(ctx, { includeArchived: true }),
  ])
  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-0 min-w-0 flex-col gap-3">
      <div className="hidden shrink-0 md:block">
        <PageHeader title={t("title")} description={t("subtitle")} />
      </div>
      <div className="hidden md:block"><NavTabs active="chat" tabs={[{ key: "chat", label: t("review.chatTab"), href: "/assistant" }, { key: "recommendations", label: t("review.title"), href: "/assistant/recommendations" }]} /></div>
      <AiChat
        key={id ?? "new"}
        id={id}
        initialMessages={messages}
        conversations={conversations}
        proposals={proposals.map(({ id, messageId, title, status, items, expiresAt }) => ({
          id,
          messageId,
          title,
          status,
          items,
          expired: expiresAt <= new Date(),
        }))}
        role={ctx.role}
        detailed={view.dataLevel === "detailed"}
        names={Object.fromEntries([...accounts, ...categories].map((r) => [r.id, r.name]))}
      />
    </div>
  )
}
