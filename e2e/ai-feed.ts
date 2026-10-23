import type { BrowserContext, Page } from "@playwright/test"
import { expect } from "./fixtures"

const feedViolations = new WeakMap<Page, unknown[]>()
const marker = "AI_FEED_DIAGNOSTIC "

/** Keep observations across reloads, including hidden SSR containers and cached route trees. */
export async function watchAiFeed(page: Page) {
  const violations: unknown[] = []
  feedViolations.set(page, violations)
  page.on("console", (message) => {
    if (message.text().startsWith(marker)) violations.push(JSON.parse(message.text().slice(marker.length)))
  })
  await page.addInitScript(() => {
    let recorded = false
    new MutationObserver(() => {
      const feeds = [...document.querySelectorAll('[data-testid="ai-messages"]')]
      if (feeds.length <= 1 || recorded) return
      recorded = true
      const snapshot = feeds.map((feed) => {
        const ancestors = []
        for (let parent = feed.parentElement; parent; parent = parent.parentElement)
          ancestors.push({ tag: parent.tagName, id: parent.id, hidden: parent.hidden, display: parent.style.display })
        return { ancestors }
      })
      console.debug("AI_FEED_DIAGNOSTIC " + JSON.stringify(snapshot))
    }).observe(document, { childList: true, subtree: true })
  })
}

export async function expectSingleAiFeed(page: Page) {
  await expect(page.getByTestId("ai-messages")).toHaveCount(1)
  await page.evaluate(() => Promise.resolve())
  expect(feedViolations.get(page), "Only one message feed may exist, including hidden SSR containers").toEqual([])
}

/** Hold application scripts to exercise the streamed HTML and the subsequent feed mount separately. */
export async function expectAiFeedHydration(context: BrowserContext, url: string) {
  const page = await context.newPage()
  await watchAiFeed(page)
  let releaseScripts = () => {}
  const scriptsReady = new Promise<void>((resolve) => {
    releaseScripts = resolve
  })
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    await scriptsReady
    await route.continue()
  })
  try {
    await page.goto(url, { waitUntil: "commit" })
    const composer = page.getByTestId("ai-composer").getByRole("textbox")
    await expect
      .poll(() => composer.evaluateAll((fields) => fields.length > 0 && fields.every((field) => (field as HTMLTextAreaElement).disabled)))
      .toBe(true)
    await expect(page.getByTestId("ai-messages")).toHaveCount(0)
    releaseScripts()
    await expect(composer).toHaveCount(1)
    await expect(composer).toBeEnabled()
    await expectSingleAiFeed(page)
    await expect
      .poll(() => page.getByTestId("ai-messages").evaluate((feed) => feed.scrollHeight - feed.scrollTop - feed.clientHeight < 48))
      .toBe(true)
  } finally {
    releaseScripts()
    await page.unrouteAll({ behavior: "wait" })
    await page.close()
  }
}
