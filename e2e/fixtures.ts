import { expect, test as base, type BrowserContext, type Page } from "@playwright/test"
import { BROWSER_TIMEZONE } from "../playwright.config"

export { expect, type Page } from "@playwright/test"

/** Check every page, including manually created contexts, before a test can pass. */
export const test = base.extend<{ hydrationGuard: void }>({
  hydrationGuard: [async ({ browser, context }, run) => {
    const errors: string[] = []
    const observePage = (page: Page) => {
      page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`))
      page.on("console", (message) => {
        if (message.type() === "error" && /hydrat|server.rendered|didn.t match|Minified React error #418/i.test(message.text())) {
          errors.push(`${page.url()}: ${message.text()}`)
        }
      })
    }
    const observeContext = (value: BrowserContext) => {
      value.pages().forEach(observePage)
      value.on("page", observePage)
      return value
    }
    observeContext(context)
    const newContext = browser.newContext
    browser.newContext = async (options) => observeContext(await newContext.call(browser, { timezoneId: BROWSER_TIMEZONE, ...options }))
    try {
      await run()
      expect(errors, "All browser contexts must remain free of hydration and runtime errors").toEqual([])
    } finally {
      browser.newContext = newContext
    }
  }, { auto: true }],
})
