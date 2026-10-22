"use client"

/** Last-resort boundary when the root layout itself fails: plain markup, no app styles. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>Что-то пошло не так</h1>
          <p style={{ color: "#666" }}>Обновите страницу или попробуйте позже.</p>
          <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", cursor: "pointer" }}>
            Повторить
          </button>
        </div>
      </body>
    </html>
  )
}
