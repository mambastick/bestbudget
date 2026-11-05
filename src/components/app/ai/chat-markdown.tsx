"use client"

import { memo } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm, { type Options as GfmOptions } from "remark-gfm"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { repairMarkdownTail } from "@/domain/ai/markdown"
import { useSmoothText } from "@/hooks/use-smooth-text"
import { cn } from "@/lib/utils"

// A single tilde is everyday notation for "about" in money answers, not strikethrough.
const remarkPlugins: [typeof remarkGfm, GfmOptions][] = [[remarkGfm, { singleTilde: false }]]

/** Model output is untrusted: only absolute web and mail links survive. */
function safeUrl(url: string) {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : null
}

const headingSpacing = "mt-5 first:mt-0"

type HastNode = { value?: unknown; children?: unknown[] }

function nodeText(node?: HastNode): string {
  if (!node) return ""
  return typeof node.value === "string" ? node.value : (node.children ?? []).map((child) => nodeText(child as HastNode)).join("")
}

/** Amounts and labels stay on one line, and the table scrolls instead. Only real sentences wrap. */
function cellWrap(node?: HastNode) {
  return nodeText(node).length <= 16 ? "whitespace-nowrap" : "min-w-40 whitespace-normal"
}

const components: Components = {
  h1: ({ children }) => <h1 className={cn("text-lg font-semibold", headingSpacing)}>{children}</h1>,
  h2: ({ children, className }) => <h2 className={cn("text-base font-semibold", headingSpacing, className)}>{children}</h2>,
  h3: ({ children }) => <h3 className={cn("font-semibold", headingSpacing)}>{children}</h3>,
  h4: ({ children }) => <h4 className={cn("font-medium", headingSpacing)}>{children}</h4>,
  h5: ({ children }) => <h5 className={cn("font-medium text-muted-foreground", headingSpacing)}>{children}</h5>,
  h6: ({ children }) => <h6 className={cn("font-medium text-muted-foreground", headingSpacing)}>{children}</h6>,
  ul: ({ children, className }) => <ul className={cn("list-disc space-y-1 pl-5 marker:text-muted-foreground", className)}>{children}</ul>,
  ol: ({ children, start, className }) => (
    <ol start={start} className={cn("list-decimal space-y-1 pl-5 marker:text-muted-foreground", className)}>
      {children}
    </ol>
  ),
  li: ({ children, className }) => (
    <li className={cn("pl-0.5 [&>ol]:mt-1 [&>p+p]:mt-2 [&>ul]:mt-1", className === "task-list-item" && "-ml-5 list-none")}>{children}</li>
  ),
  input: ({ type, checked }) => <input type={type} checked={checked} disabled readOnly className="mr-1.5 align-middle" />,
  blockquote: ({ children }) => <blockquote className="space-y-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-4" />,
  del: ({ children }) => <del className="text-muted-foreground line-through">{children}</del>,
  a: ({ children, href }) =>
    href ? (
      <a href={href} title={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: () => null,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] break-words">{children}</code>,
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-hidden rounded-lg border">
      <Table className="tabular">{children}</Table>
    </div>
  ),
  thead: ({ children }) => <TableHeader className="bg-muted/50">{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow className="hover:bg-transparent">{children}</TableRow>,
  th: ({ children, style, node }) => (
    <TableHead style={style} className={cn("h-auto px-3 py-2 align-bottom", cellWrap(node))}>
      {children}
    </TableHead>
  ),
  td: ({ children, style, node }) => (
    <TableCell style={style} className={cn("px-3 py-2 align-top", cellWrap(node))}>
      {children}
    </TableCell>
  ),
}

/** Memoized: finished messages must not re-parse on every streamed chunk of the current one. */
const ChatMarkdown = memo(function ChatMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <div className="ai-markdown min-w-0 space-y-3 px-1 text-sm leading-relaxed break-words" data-streaming={streaming || undefined}>
      <Markdown skipHtml remarkPlugins={remarkPlugins} urlTransform={safeUrl} components={components}>
        {text}
      </Markdown>
    </div>
  )
})

export function AssistantText({ text, streaming }: { text: string; streaming: boolean }) {
  const shown = useSmoothText(text, streaming)
  const unfinished = streaming || shown.length < text.length
  return <ChatMarkdown text={repairMarkdownTail(shown, { streaming: unfinished })} streaming={unfinished} />
}
