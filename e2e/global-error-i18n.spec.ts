import { build } from "esbuild"
import { expect, test } from "./fixtures"

let script: string

test.beforeAll(async () => {
  const result = await build({
    stdin: {
      contents: `import { createElement } from "react"
import { createRoot } from "react-dom/client"
import GlobalError from "./src/app/global-error"
createRoot(document).render(createElement(GlobalError, {
  error: new Error("Synthetic root layout failure"),
  reset: () => { document.documentElement.dataset.retried = "true" },
}))`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  })
  script = result.outputFiles[0]!.text
})

for (const [language, locale, heading, retry] of [
  ["ru-RU", "ru", "Что-то пошло не так", "Повторить"],
  ["en-US", "en", "Something went wrong", "Try again"],
  ["fr-FR", "en", "Something went wrong", "Try again"],
] as const) {
  test(`global error works without app providers in ${language}`, async ({ browser }) => {
    const context = await browser.newContext({ locale: language })
    try {
      const page = await context.newPage()
      await page.route("**/__global-error-test", (route) => route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><html><head></head><body></body></html>",
      }))
      await page.goto("/__global-error-test")
      await page.addScriptTag({ content: script })
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible()
      await expect(page.locator("html")).toHaveAttribute("lang", locale)
      await page.getByRole("button", { name: retry, exact: true }).click()
      await expect(page.locator("html")).toHaveAttribute("data-retried", "true")
    } finally { await context.close() }
  })
}
