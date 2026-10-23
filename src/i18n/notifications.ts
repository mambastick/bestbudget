import { createTranslator } from "use-intl/core"
import en from "../../messages/en/notifications.json"
import ru from "../../messages/ru/notifications.json"
import type { Locale } from "./locale"

export function notificationTranslator(locale: Locale) {
  return createTranslator({ locale, messages: locale === "ru" ? ru : en })
}
