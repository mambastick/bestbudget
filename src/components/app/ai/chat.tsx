"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, isToolUIPart, getToolName, type UIMessage } from "ai"
import { useSyncExternalStore, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { useReducedMotion } from "motion/react"
import { Sparkles, Plus, Send, Square, Trash2, MessagesSquare, MessageSquare, MoreHorizontal, ArrowDown, Pencil, TriangleAlert } from "lucide-react"
import { createAiConversationAction, deleteAiConversationAction } from "@/app/actions/ai"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/app/empty-state"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { LinkButton } from "@/components/app/link-button"
import { useAction } from "@/hooks/use-action"
import type { HouseholdRole } from "@/domain/permissions"
import { can } from "@/domain/permissions"
import { INTERVIEW_STEPS, interviewProgress } from "@/domain/ai/interview"
import { truncationReason } from "@/domain/ai/truncation"
import { cn } from "@/lib/utils"
import { AssistantText } from "./chat-markdown"
import { ConversationRename } from "./conversation-rename"
import { InterviewStart } from "./interview-start"
import { ProposalCard, type ProposalView } from "./proposal-card"

const ENTER_ANIMATION = "animate-in fade-in-0 slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"

export function AiChat({
  id,
  kind,
  initialMessages,
  conversations,
  proposals,
  role,
  detailed,
  names,
}: {
  id?: string
  kind?: "chat" | "onboarding" | "review"
  initialMessages: UIMessage[]
  conversations: { id: string; title: string; kind: "chat" | "onboarding" | "review"; version: number }[]
  proposals: ProposalView[]
  role: HouseholdRole
  detailed: boolean
  names: Record<string, string>
}) {
  const t = useTranslations("ai"),
    router = useRouter()
  const { pending, run } = useAction()
  const [input, setInput] = useState("")
  const [navigating, setNavigating] = useState(false)
  const [dialogsOpen, setDialogsOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [rename, setRename] = useState<{ id: string; title: string; version: number } | null>(null)
  const [pinned, setPinned] = useState(true)
  const pin = useRef(true)
  const lastScrollTop = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const feed = useRef<HTMLDivElement>(null)
  const feedContent = useRef<HTMLDivElement>(null)
  // What the page opened with is history: only later arrivals animate in.
  const [history] = useState(() => new Set([...initialMessages.map((m) => m.id), ...proposals.map((p) => p.id)]))
  const reducedMotion = useReducedMotion()
  const field = useRef<HTMLTextAreaElement>(null)
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
    experimental_throttle: 40,
    onFinish: () => router.refresh(),
  })
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const progress = kind === "onboarding" ? interviewProgress(messages) : null
  const restricted = kind === "onboarding" && !can(role, "catalog.manage")
  const busy = status === "submitted" || status === "streaming"
  // The stored messages arrive through the same refresh that brings in new proposals.
  const truncations = useMemo(() => new Map(initialMessages.map((m) => [m.id, truncationReason(m)])), [initialMessages])
  useEffect(() => {
    const viewport = window.visualViewport
    function resize() {
      if (!root.current) return
      const mobile = window.matchMedia("(max-width: 767px)").matches
      root.current.style.height = mobile ? `${viewport?.height ?? window.innerHeight}px` : ""
      root.current.style.top = mobile ? `${viewport?.offsetTop ?? 0}px` : ""
    }
    resize()
    viewport?.addEventListener("resize", resize)
    viewport?.addEventListener("scroll", resize)
    window.addEventListener("resize", resize)
    return () => {
      viewport?.removeEventListener("resize", resize)
      viewport?.removeEventListener("scroll", resize)
      window.removeEventListener("resize", resize)
    }
  }, [])
  useLayoutEffect(() => {
    if (pin.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight
  }, [hydrated, messages, status, proposals])
  useEffect(() => {
    // Smoothed text, proposal cards and the on-screen keyboard all change height between message updates.
    if (!feed.current || !feedContent.current) return
    const observer = new ResizeObserver(() => {
      if (pin.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight
    })
    observer.observe(feed.current)
    observer.observe(feedContent.current)
    return () => observer.disconnect()
  }, [hydrated])
  function scrollToLatest(behavior: ScrollBehavior = "auto") {
    pin.current = true
    setPinned(true)
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior })
  }
  function newConversation() {
    run(createAiConversationAction, {
      onSuccess: (data) => {
        setDialogsOpen(false)
        setNavigating(true)
        router.push(`/assistant?id=${data.id}`)
      },
    })
  }
  function conversationList() {
    return (
      <>
        <Button className="w-full" variant="outline" disabled={!hydrated || pending || busy || navigating} onClick={newConversation}>
          <Plus className="size-4" />
          {t("newChat")}
        </Button>
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto" aria-label={t("conversations")}>
          {conversations.map((c) => (
            <div
              key={c.id}
              data-active={id === c.id || undefined}
              className="group/row flex min-w-0 shrink-0 items-center gap-0.5 rounded-lg pr-1 transition-colors hover:bg-muted data-active:bg-secondary"
            >
              <LinkButton
                href={`/assistant?id=${c.id}`}
                variant="ghost"
                className="h-9 min-w-0 flex-1 justify-start gap-2 pr-1 pl-2.5 font-normal hover:bg-transparent dark:hover:bg-transparent group-data-active/row:font-medium"
                aria-current={id === c.id ? "page" : undefined}
                aria-disabled={busy}
                onClick={(e) => {
                  if (busy) e.preventDefault()
                  else setDialogsOpen(false)
                }}
              >
                {c.kind === "onboarding" ? (
                  <Sparkles className="size-4 text-muted-foreground" role="img" aria-label={t("interview.badge")} />
                ) : (
                  <MessageSquare className="size-4 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate" title={c.title}>
                  {c.title}
                </span>
              </LinkButton>
              <DropdownMenu animated={false}>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/row:opacity-100 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-data-active/row:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100"
                      disabled={!hydrated || pending || busy || navigating}
                      aria-label={t("conversationMenu", { title: c.title })}
                    />
                  }
                >
                  <MoreHorizontal className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setRename(c)}>
                    <Pencil />
                    {t("renameChat")}
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleteId(c.id)}>
                    <Trash2 />
                    {t("deleteChat")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </nav>
      </>
    )
  }
  const starters = ["spending", "save", "budgets", ...(detailed ? ["subscriptions"] : [])]
  const lastTool = messages
    .at(-1)
    ?.parts.filter(isToolUIPart)
    .findLast((p) => !["output-available", "output-error"].includes(p.state))
  const toolName = lastTool ? getToolName(lastTool) : ""
  const streamingText = status === "streaming" && messages.at(-1)?.parts.at(-1)?.type === "text"
  function edit(text: string) {
    setInput(text)
    field.current?.focus()
  }
  return (
    <div
      ref={root}
      data-testid="ai-chat"
      data-conversation-id={id ?? ""}
      className="fixed inset-x-0 top-0 z-30 grid h-dvh min-h-0 min-w-0 grid-cols-1 bg-background md:static md:z-auto md:h-auto md:flex-1 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-3"
    >
      <aside className="hidden min-h-0 min-w-0 flex-col gap-3 lg:flex">{conversationList()}</aside>
      {rename ? <ConversationRename key={`${rename.id}:${rename.version}`} conversation={rename} onClose={() => setRename(null)} /> : null}
      <ConfirmDialog
        title={t("deleteChat")}
        description={t("deleteHint")}
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        onConfirm={() => {
          if (deleteId)
            run(() => deleteAiConversationAction(deleteId), {
              onSuccess: () => {
                setDialogsOpen(false)
                if (deleteId === id) router.push("/assistant")
              },
            })
        }}
      />
      <section className="flex min-h-0 min-w-0 flex-col bg-card md:overflow-hidden md:rounded-xl md:border" aria-label={t("title")}>
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
          <SidebarTrigger className="md:hidden" />
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="ai-chat-title">
            {conversations.find((c) => c.id === id)?.title ?? t("newChat")}
          </h1>
          <LinkButton href="/assistant/recommendations" size="sm" variant="ghost">{t("review.title")}</LinkButton>
          <Sheet open={dialogsOpen} onOpenChange={setDialogsOpen}>
            <SheetTrigger render={<Button variant="outline" size="sm" disabled={!hydrated} />}>
              <MessagesSquare className="size-4" />
              <span className="sr-only sm:not-sr-only">{t("conversations")}</span>
            </SheetTrigger>
            <SheetContent side="left" className="w-[min(90vw,24rem)]">
              <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
                <SheetHeader className="p-0 pr-10">
                  <SheetTitle>{t("conversations")}</SheetTitle>
                </SheetHeader>
                {conversationList()}
              </div>
            </SheetContent>
          </Sheet>
        </header>
        {kind === "onboarding" ? (
          <div className="shrink-0 space-y-2 border-b p-3" data-testid="ai-interview-progress">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="font-medium">
                {t("interview.step", { step: progress ? INTERVIEW_STEPS.indexOf(progress.step) + 1 : 1 })} ·{" "}
                {t(`interview.steps.${progress?.step ?? "income"}`)}
              </p>
              <LinkButton
                href="/dashboard"
                variant="ghost"
                size="sm"
                aria-disabled={busy}
                onClick={(e) => {
                  if (busy) e.preventDefault()
                }}
              >
                {t("interview.pause")}
              </LinkButton>
            </div>
            <ol className="grid grid-cols-5 gap-1" aria-label={t("interview.title")}>
              {INTERVIEW_STEPS.map((step, index) => (
                <li
                  key={step}
                  aria-current={step === (progress?.step ?? "income") ? "step" : undefined}
                  title={t(`interview.steps.${step}`)}
                  className={`h-1 rounded-full ${index <= (progress ? INTERVIEW_STEPS.indexOf(progress.step) : 0) ? "bg-primary" : "bg-muted"}`}
                />
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">{t("interview.saved")}</p>
          </div>
        ) : null}
        {/* Streaming SSR can replay hidden boundaries; mount the live scroll container only after hydration. */}
        {hydrated ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div
              ref={feed}
              data-testid="ai-messages"
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
              aria-live="polite"
              aria-busy={streamingText}
              onScroll={() => {
                const el = feed.current
                if (!el) return
                const distance = el.scrollHeight - el.scrollTop - el.clientHeight
                const moved = el.scrollTop - lastScrollTop.current
                lastScrollTop.current = el.scrollTop
                // Any move up releases the feed at once, even near the bottom. Moving down far from it
                // does not: that is the smooth scroll to the latest message, or text outrunning this event.
                if (moved < -1 && distance > 1) pin.current = false
                else if (distance < 48) pin.current = true
                else if (moved <= 0) pin.current = false
                setPinned(pin.current)
              }}
            >
              <div ref={feedContent} className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5">
                {!messages.length ? (
                  <>
                    <EmptyState icon={Sparkles} title={t("emptyTitle")} description={t("emptyHint")} />
                    {kind !== "onboarding" && can(role, "catalog.manage") ? <InterviewStart /> : null}
                    <div className="flex flex-wrap gap-2">
                      {(kind === "onboarding" ? [] : starters).map((key) => (
                        <Button
                          key={key}
                          variant="outline"
                          className="h-auto max-w-full whitespace-normal text-left"
                          disabled={!hydrated}
                          onClick={() => edit(t(`starters.${key}`))}
                        >
                          {t(`starters.${key}`)}
                        </Button>
                      ))}
                    </div>
                  </>
                ) : null}
                {messages.map((m) => {
                  const truncation = truncations.get(m.id)
                  return (
                    <div key={m.id} className={cn("min-w-0 space-y-3 empty:hidden", !history.has(m.id) && ENTER_ANIMATION)}>
                      {m.parts.map((p, i) =>
                        p.type !== "text" ? null : m.role === "user" ? (
                          <p
                            key={i}
                            className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap"
                          >
                            {p.text}
                          </p>
                        ) : (
                          <AssistantText key={i} text={p.text} streaming={busy && p.state === "streaming" && m.id === messages.at(-1)?.id} />
                        ),
                      )}
                      {truncation ? (
                        <div
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
                          data-testid="ai-truncated"
                        >
                          <TriangleAlert className="size-4 shrink-0 text-warning" />
                          <p className="min-w-0 flex-1 basis-48">{t(`truncated.${truncation}`)}</p>
                          {m.id === messages.at(-1)?.id && !busy && !restricted ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                scrollToLatest()
                                void sendMessage({ text: t("continuePrompt") })
                              }}
                            >
                              {t("continue")}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      {proposals
                        .filter((p) => p.messageId === m.id)
                        .map((p) => (
                          <div key={p.id} className={cn("min-w-0", !history.has(p.id) && ENTER_ANIMATION)}>
                            <ProposalCard interview={kind === "onboarding"} proposal={p} role={role} names={names} onEdit={edit} />
                          </div>
                        ))}
                    </div>
                  )
                })}
                {busy && !streamingText ? (
                  <p
                    className={cn("flex items-center gap-2.5 px-1 text-sm text-muted-foreground", ENTER_ANIMATION)}
                    role="status"
                    data-testid="ai-status"
                  >
                    <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
                      <span className="ai-dot" />
                      <span className="ai-dot" />
                      <span className="ai-dot" />
                    </span>
                    {toolName && t.has(`tools.${toolName}`) ? t(`tools.${toolName}`) : t("thinking")}
                  </p>
                ) : null}
              </div>
            </div>
            {!pinned ? (
              <Button
                variant="secondary"
                size="sm"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none"
                onClick={() => scrollToLatest(reducedMotion ? "auto" : "smooth")}
              >
                <ArrowDown className="size-4" />
                {t("latest")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div role="status" className="min-h-0 flex-1 p-4 text-sm text-muted-foreground">
            {t("loadingMessages")}
          </div>
        )}
        {restricted ? (
          <p role="alert" className="border-t p-3 text-sm text-muted-foreground">
            {t("noPermission")}
          </p>
        ) : null}
        {progress && !busy && !error && !proposals.some((p) => p.messageId === messages.at(-1)?.id) ? (
          <div className={cn("flex shrink-0 flex-wrap gap-2 border-t px-3 py-2", ENTER_ANIMATION)} data-testid="ai-interview-chips">
            {progress.quickReplies.map((reply) => (
              <Button
                key={reply}
                size="sm"
                variant="outline"
                className="h-auto max-w-full whitespace-normal text-left"
                disabled={!hydrated || restricted || pending}
                onClick={() => {
                  scrollToLatest()
                  void sendMessage({ text: reply })
                }}
              >
                {reply}
              </Button>
            ))}
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-destructive"
            data-testid="ai-error"
          >
            <p className="min-w-0 flex-1">{t("error")}</p>
            <Button
              variant="outline"
              onClick={() => {
                scrollToLatest()
                void regenerate()
              }}
            >
              {t("retry")}
            </Button>
          </div>
        ) : null}
        <form
          data-testid="ai-composer"
          className="shrink-0 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onSubmit={(e) => {
            e.preventDefault()
            if (!hydrated || restricted || !input.trim() || busy) return
            if (!id) {
              run(createAiConversationAction, {
                onSuccess: (data) => {
                  setNavigating(true)
                  sessionStorage.setItem(`ai-draft-${data.id}`, input)
                  router.push(`/assistant?id=${data.id}`)
                },
              })
              return
            }
            scrollToLatest()
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
          <div className="relative mx-auto w-full max-w-3xl">
            <Textarea
              ref={field}
              disabled={!hydrated || restricted || pending || navigating}
              value={input}
              maxLength={4000}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              className="max-h-40 min-h-12 resize-none rounded-xl py-3 pr-12 pl-3.5 text-base md:text-sm"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
            />
            {busy ? (
              <Button type="button" size="icon" className="absolute right-2 bottom-2" aria-label={t("stop")} onClick={() => void stop()}>
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                className="absolute right-2 bottom-2"
                disabled={!hydrated || restricted || !input.trim() || pending || navigating}
                aria-label={t("send")}
              >
                <Send className="size-4" />
              </Button>
            )}
          </div>
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

const subscribe = () => () => {}
