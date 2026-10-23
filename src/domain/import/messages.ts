import { createTranslator } from "use-intl/core"
import ru from "../../../messages/ru/import.json"
import en from "../../../messages/en/import.json"
import { formatDayShort, isIsoDate } from "@/lib/dates"

type MessageCode = keyof typeof en.notices
type Params = Record<string, string | number>
const prefix = "bb-import:"

/** Message identities fit the existing JSON string arrays without a database migration. */
export function importMessage(code: MessageCode, params: Params = {}): string {
  return prefix + JSON.stringify({ code, params })
}

function legacyMessage(value: string): { code: MessageCode; params: Params } | null {
  // Drafts created before i18n stored Russian text. Recognise only our own templates; preserve bank/user data.
  for (const [code, template] of Object.entries(ru.notices)) {
    const names: string[] = []
    const pattern = template
      .split(/(\{\w+\})/)
      .map((part) => {
        if (/^\{\w+\}$/.test(part)) {
          names.push(part.slice(1, -1))
          return "(.*?)"
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      })
      .join("")
    const match = new RegExp(`^${pattern}$`, "s").exec(value)
    if (match) return { code: code as MessageCode, params: Object.fromEntries(names.map((name, i) => [name, match[i + 1]!])) }
  }
  return null
}

export function importMessageData(value: string): { code: MessageCode; params: Params } | null {
  if (!value.startsWith(prefix)) return legacyMessage(value)
  try {
    const parsed: unknown = JSON.parse(value.slice(prefix.length))
    if (!parsed || typeof parsed !== "object" || !("code" in parsed) || !("params" in parsed)) return null
    if (typeof parsed.code !== "string" || !Object.hasOwn(en.notices, parsed.code)) return null
    if (!parsed.params || typeof parsed.params !== "object" || Array.isArray(parsed.params)) return null
    if (!Object.values(parsed.params).every((p) => typeof p === "string" || typeof p === "number")) return null
    return parsed as { code: MessageCode; params: Params }
  } catch {
    return null
  }
}

export function translateImportMessage(value: string, locale: string): string {
  const message = importMessageData(value)
  if (!message) return value
  const params = { ...message.params }
  if (typeof params.date === "string" && isIsoDate(params.date)) params.date = formatDayShort(params.date, locale)
  const t = createTranslator({ locale, messages: locale.startsWith("ru") ? ru.notices : en.notices })
  if (message.code === "accountRequired" && !params.name) params.name = t("noAccountHint")
  return t(message.code, params)
}
