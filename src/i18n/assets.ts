import { createTranslator } from "use-intl/core"
import ruLoans from "../../messages/ru/loans.json"
import enLoans from "../../messages/en/loans.json"
import ruGoals from "../../messages/ru/goals.json"
import enGoals from "../../messages/en/goals.json"
import ruImport from "../../messages/ru/import.json"
import enImport from "../../messages/en/import.json"

import ruAi from "../../messages/ru/ai.json"
import enAi from "../../messages/en/ai.json"

const messages = { ru: { loans: ruLoans, goals: ruGoals, import: ruImport, ai: ruAi }, en: { loans: enLoans, goals: enGoals, import: enImport, ai: enAi } }

/** Services and jobs receive locale from their caller instead of reading HTTP request state. */
export function assetTranslator<N extends keyof typeof messages.en>(namespace: N, locale = "ru") {
  return createTranslator({ locale, messages: messages[locale.startsWith("ru") ? "ru" : "en"][namespace] })
}
