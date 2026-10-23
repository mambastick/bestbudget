"use client"

import { useSyncExternalStore } from "react"

const messages = {
  ru: { title: "Что-то пошло не так", description: "Обновите страницу или попробуйте позже.", retry: "Повторить" },
  en: { title: "Something went wrong", description: "Refresh the page or try again later.", retry: "Try again" },
}
const subscribe = () => () => {}
const browserLanguage = () => navigator.language.toLowerCase().split("-")[0] === "ru" ? "ru" : "en"
const serverLanguage = () => "en" as const

/** Last-resort boundary when the root layout itself fails: plain markup, no app styles. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const locale = useSyncExternalStore(subscribe, browserLanguage, serverLanguage)
  const t = messages[locale]
  return (
    <html lang={locale}>
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>{t.title}</h1>
          <p style={{ color: "#666" }}>{t.description}</p>
          <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}>
            {t.retry}
          </button>
        </div>
      </body>
    </html>
  )
}
