"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, isToolUIPart, getToolName, type UIMessage } from "ai"
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import Markdown from "react-markdown"
import { Sparkles, Plus, Send, Square, Trash2 } from "lucide-react"
import { createAiConversationAction, deleteAiConversationAction } from "@/app/actions/ai"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/app/empty-state"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { LinkButton } from "@/components/app/link-button"
import { useAction } from "@/hooks/use-action"
import type { HouseholdRole } from "@/domain/permissions"
import { ProposalCard, type ProposalView } from "./proposal-card"

export function AiChat({
  id,
  initialMessages,
  conversations,
  proposals,
  role,
  detailed,
  names,
}: {
  id?: string
  initialMessages: UIMessage[]
  conversations: { id: string; title: string }[]
  proposals: ProposalView[]
  role: HouseholdRole
  detailed: boolean
  names: Record<string, string>
}) {
  const t = useTranslations("ai"),
    router = useRouter()
  const { pending, run } = useAction()
  const [input, setInput] = useState("")
  const bottom = useRef<HTMLDivElement>(null),
    field = useRef<HTMLTextAreaElement>(null)
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        prepareSendMessagesRequest: ({ messages }) => ({ body: { id, message: messages.findLast((m) => m.role === "user") } }),
      }),
    [id],
  )
  const { messages, sendMessage, status, error, regenerate, stop } = useChat({
    id,
    messages: initialMessages,
    transport,
    generateId: () => crypto.randomUUID(),
    onFinish: () => router.refresh(),
  })
  const busy = status === "submitted" || status === "streaming"
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" })
  }, [messages, status])
  const starters = ["spending", "save", "budgets", ...(detailed ? ["subscriptions"] : [])]
  const lastTool = messages
    .at(-1)
    ?.parts.filter(isToolUIPart)
    .findLast((p) => !["output-available", "output-error"].includes(p.state))
  const toolName = lastTool ? getToolName(lastTool) : ""
  function edit(text: string) {
    setInput(text)
    field.current?.focus()
  }
  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-3 lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="flex min-w-0 flex-wrap items-center gap-2 lg:block lg:space-y-3">
        <Button
          className="lg:w-full"
          variant="outline"
          disabled={pending || busy}
          onClick={() => run(createAiConversationAction, { onSuccess: (data) => router.push(`/assistant?id=${data.id}`) })}
        >
          <Plus className="size-4" />
          {t("newChat")}
        </Button>
        <select
          aria-label={t("conversations")}
          value={id ?? ""}
          disabled={busy}
          onChange={(e) => router.push(e.target.value ? `/assistant?id=${e.target.value}` : "/assistant")}
          className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm lg:hidden"
        >
          <option value="">{t("title")}</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <nav className="hidden max-h-32 flex-col gap-1 overflow-y-auto lg:flex lg:max-h-[65dvh]">
          {conversations.map((c) => (
            <LinkButton
              key={c.id}
              href={`/assistant?id=${c.id}`}
              variant={id === c.id ? "secondary" : "ghost"}
              className="justify-start"
              aria-current={id === c.id ? "page" : undefined}
            >
              <span className="truncate">{c.title}</span>
            </LinkButton>
          ))}
        </nav>
        {id ? (
          <ConfirmDialog
            title={t("deleteChat")}
            description={t("deleteHint")}
            trigger={
              <Button variant="ghost" size="sm" disabled={pending || busy}>
                <Trash2 className="size-4" />
                <span className="sr-only lg:not-sr-only">{t("deleteChat")}</span>
              </Button>
            }
            onConfirm={() => run(() => deleteAiConversationAction(id), { onSuccess: () => router.push("/assistant") })}
          />
        ) : null}
      </aside>
      <section className="flex min-h-0 min-w-0 flex-col rounded-xl border bg-card" aria-label={t("title")}>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4" aria-live="polite">
          {!messages.length ? (
            <>
              <EmptyState icon={Sparkles} title={t("emptyTitle")} description={t("emptyHint")} />
              <div className="flex flex-wrap gap-2">
                {starters.map((key) => (
                  <Button
                    key={key}
                    variant="outline"
                    className="h-auto max-w-full whitespace-normal text-left"
                    onClick={() => edit(t(`starters.${key}`))}
                  >
                    {t(`starters.${key}`)}
                  </Button>
                ))}
              </div>
            </>
          ) : null}
          {messages.map((m) => (
            <div key={m.id} className="min-w-0 space-y-3">
              {m.parts
                .filter((p) => p.type === "text")
                .map((p, i) => (
                  <div
                    key={i}
                    className={`min-w-0 space-y-2 break-words text-sm [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_code]:break-all [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 ${m.role === "user" ? "ml-auto max-w-[90%] rounded-xl bg-muted px-4 py-3" : "px-1 py-2"}`}
                  >
                    <Markdown skipHtml components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>
                      {p.type === "text" ? p.text : ""}
                    </Markdown>
                  </div>
                ))}
              {proposals
                .filter((p) => p.messageId === m.id)
                .map((p) => (
                  <ProposalCard key={p.id} proposal={p} role={role} names={names} onEdit={edit} />
                ))}
            </div>
          ))}
          {busy ? (
            <p className="animate-pulse text-sm text-muted-foreground" role="status">
              {toolName && t.has(`tools.${toolName}`) ? t(`tools.${toolName}`) : t("thinking")}
            </p>
          ) : null}
          {error ? (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{error.message || t("error")}</p>
              <Button variant="outline" onClick={() => void regenerate()}>
                {t("retry")}
              </Button>
            </div>
          ) : null}
          <div ref={bottom} />
        </div>
        <form
          className="flex shrink-0 items-end gap-2 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault()
            if (!input.trim() || busy) return
            if (!id) {
              run(createAiConversationAction, {
                onSuccess: (data) => {
                  sessionStorage.setItem(`ai-draft-${data.id}`, input)
                  router.push(`/assistant?id=${data.id}`)
                },
              })
              return
            }
            void sendMessage({ text: input })
            setInput("")
          }}
        >
          <DraftLoader
            id={id}
            onDraft={(text) => {
              void sendMessage({ text })
            }}
          />
          <Textarea
            ref={field}
            value={input}
            maxLength={4000}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            className="max-h-40 min-h-12 min-w-0 flex-1 resize-none"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />
          {busy ? (
            <Button type="button" size="icon" aria-label={t("stop")} onClick={() => void stop()}>
              <Square className="size-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!input.trim() || pending} aria-label={t("send")}>
              <Send className="size-4" />
            </Button>
          )}
        </form>
      </section>
    </div>
  )
}
function DraftLoader({ id, onDraft }: { id?: string; onDraft: (text: string) => void }) {
  const loaded = useRef(false)
  useEffect(() => {
    if (!id || loaded.current) return
    loaded.current = true
    const key = `ai-draft-${id}`,
      text = sessionStorage.getItem(key)
    if (text) {
      sessionStorage.removeItem(key)
      onDraft(text)
    }
  }, [id, onDraft])
  return null
}
