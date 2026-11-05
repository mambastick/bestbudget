import { createTranslator } from "use-intl/core"
import ru from "../../../messages/ru/ai.json"
import en from "../../../messages/en/ai.json"

/** Format on the server with the household time zone; never depend on the browser clock. */
export function interviewConversationTitle(createdAt: Date, timezone: string, locale = "ru") {
  const language = locale.startsWith("ru") ? "ru" : "en"
  const date = new Intl.DateTimeFormat(language, { day: "numeric", month: "short", timeZone: timezone }).format(createdAt)
  const t = createTranslator({ locale: language, messages: language === "ru" ? ru : en })
  return t("interview.conversationTitle", { date })
}

const TITLE_LIMIT = 60

/** The first line of the message as one short line, cut on a word boundary. */
export function conversationTitleFromMessage(text: string) {
  const line = (text.split("\n").find((candidate) => candidate.trim()) ?? "").trim().replace(/\s+/g, " ")
  const chars = Array.from(line)
  if (chars.length <= TITLE_LIMIT) return line
  const cut = chars.slice(0, TITLE_LIMIT - 1).join("")
  const space = cut.lastIndexOf(" ")
  return `${space > TITLE_LIMIT / 2 ? cut.slice(0, space) : cut.trimEnd()}…`
}
