import ru from "../../../../messages/ru/pwa.json"
import en from "../../../../messages/en/pwa.json"

export const dynamic = "force-static"
export function generateStaticParams() { return [{ locale: "ru" }, { locale: "en" }] }

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
}

/** Standalone public HTML: no React runtime, authenticated layout, session, API or financial data. */
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (locale !== "ru" && locale !== "en") return new Response(null, { status: 404 })
  const sections = (["ru", "en"] as const).map((language) => {
    const t = { ru, en }[language].offline
    return `<main data-locale="${language}"><img src="/pwa-icon/192" width="72" height="72" alt="BestBudget"><h1>${escapeHtml(t.title)}</h1><p>${escapeHtml(t.description)}</p><button onclick="location.reload()">${escapeHtml(t.retry)}</button></main>`
  }).join("")
  return new Response(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f9fafb"><title>${escapeHtml({ ru, en }[locale].offline.title)} · BestBudget</title>
<style>:root{color-scheme:light;--bg:#f9fafb;--fg:#0a0c10;--muted:#596174}.dark{color-scheme:dark;--bg:#0a0c10;--fg:#f9fafb;--muted:#b1b6c0}*{box-sizing:border-box}html{background:var(--bg);color:var(--fg);font:16px system-ui;overscroll-behavior:none}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left))}main{max-width:380px;text-align:center}h1{font-size:28px}p{line-height:1.6;color:var(--muted)}img{border-radius:16px}button{font:inherit;border:0;border-radius:12px;padding:14px 28px;background:#3b5bdb;color:white;cursor:pointer;touch-action:manipulation}html[lang=ru] [data-locale=en],html[lang=en] [data-locale=ru]{display:none}</style>
<script>var l,t;try{l=localStorage.getItem('bb_pwa_locale');t=localStorage.getItem('theme')}catch{}if(l==='ru'||l==='en')document.documentElement.lang=l;var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.querySelector('meta[name="theme-color"]').content=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();</script></head><body>${sections}<script>document.title=document.querySelector('[data-locale="'+document.documentElement.lang+'"] h1').textContent+' · BestBudget';</script></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate" },
  })
}
