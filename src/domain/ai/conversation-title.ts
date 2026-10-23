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
