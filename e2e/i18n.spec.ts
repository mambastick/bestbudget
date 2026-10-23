import { randomBytes, createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import postgres from "postgres"
import { expect, test, type Page } from "@playwright/test"
import { E2E_ENV, SETUP_TOKEN } from "../playwright.config"

const screenshotDir = "docs/screenshots/i18n"
const user = { name: "Alex Demo", email: "locale@e2e.test", password: "locale-password-1" }

async function menu(page: Page, label: string) {
  await page.getByRole("button").filter({ hasText: user.email }).click()
  await page.getByRole("menuitem", { name: label, exact: true }).click()
}
async function noOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
}

// Own synthetic user; no preference changes to users used by the Russian acceptance suite.
test("system language, saved preference and device theme work on desktop and mobile", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US", colorScheme: "light", viewport: { width: 1280, height: 900 } })
  context.setDefaultTimeout(15_000)
  await context.addInitScript(() => {
    requestAnimationFrame(() => {
      ;(window as typeof window & { firstTheme?: string }).firstTheme = document.documentElement.classList.contains("dark") ? "dark" : "light"
    })
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  await mkdir(screenshotDir, { recursive: true })
  try {
    await page.goto("/login")
    if (page.url().includes("/setup")) {
      await expect(page.getByText("Initial setup", { exact: true })).toBeVisible()
      await page.getByLabel("Setup token").fill(SETUP_TOKEN)
      await page.getByLabel("Name", { exact: true }).fill("Setup Demo")
      await page.getByLabel("E-mail").fill("setup-i18n@e2e.test")
      await page.getByLabel("Password", { exact: true }).fill("setup-password-1")
      await page.getByLabel("Confirm password").fill("setup-password-1")
      await page.getByRole("button", { name: "Create administrator", exact: true }).click()
      await expect(page).toHaveURL(/\/onboarding/)
      await page.getByRole("button", { name: "Create", exact: true }).click()
      await expect(page).toHaveURL(/\/dashboard/)
      await context.clearCookies()
      await page.goto("/login")
    }
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible()
    await expect(page).toHaveTitle("Sign in · BestBudget")
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    await page.screenshot({ path: `${screenshotDir}/login-en.png`, animations: "disabled" })
    await page.getByLabel("Language and theme", { exact: true }).click()
    await page.getByRole("menuitem", { name: "Language", exact: true }).click()
    await page.getByRole("menuitemradio", { name: "Русский", exact: true }).click()
    await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("lang", "ru")
    await page.screenshot({ path: `${screenshotDir}/login-ru.png`, animations: "disabled" })
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("lang", "ru")
    await context.clearCookies()

    // Invite directly through the isolated e2e database; acceptance can also run this test alone.
    const db = postgres(E2E_ENV.DATABASE_URL, { max: 1 })
    const token = randomBytes(24).toString("hex")
    try {
      const [household] = await db`select id from households order by created_at limit 1`
      if (!household) throw new Error("Synthetic household is missing")
      await db`insert into invitations (household_id, token_hash, role, expires_at) values (${household.id}, ${createHash("sha256").update(token).digest("hex")}, 'member', now() + interval '1 day')`
    } finally { await db.end() }
    await page.goto(`/invite/${token}`)
    await page.getByLabel("Name", { exact: true }).fill(user.name)
    await page.getByLabel("E-mail").fill(user.email)
    await page.getByLabel("Password", { exact: true }).fill(user.password)
    await page.getByLabel("Confirm password").fill(user.password)
    await page.getByRole("button", { name: "Create account and join", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole("link", { name: "Overview", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Transaction", exact: true })).toBeVisible()
    await page.goto("/settings?tab=profile")
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible()
    await page.getByRole("button").filter({ hasText: user.email }).press("ArrowDown")
    await expect(page.getByRole("menuitem", { name: "Profile and security", exact: true })).toBeFocused()
    await page.keyboard.press("Escape")
    await menu(page, "Language")
    await expect(page.getByRole("menuitemradio", { name: "System language", exact: true })).toHaveAttribute("aria-checked", "true")
    await page.screenshot({ path: `${screenshotDir}/menu-language-desktop.png`, animations: "disabled" })
    await page.getByRole("menuitemradio", { name: "Русский", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Настройки", exact: true })).toBeVisible()
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("lang", "ru")
    await menu(page, "Язык")
    await expect(page.getByRole("menuitemradio", { name: "Русский", exact: true })).toHaveAttribute("aria-checked", "true")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")

    await menu(page, "Тема")
    await page.screenshot({ path: `${screenshotDir}/menu-theme-desktop.png`, animations: "disabled" })
    await page.getByRole("menuitemradio", { name: "Тёмная", exact: true }).click()
    await expect(page.locator("html")).toHaveClass(/dark/)
    await page.reload()
    await expect(page.locator("html")).toHaveClass(/dark/)
    await expect.poll(() => page.evaluate(() => localStorage.getItem("theme"))).toBe("dark")
    await expect.poll(() => page.evaluate(() => (window as typeof window & { firstTheme?: string }).firstTheme)).toBe("dark")
    await menu(page, "Тема")
    await page.getByRole("menuitemradio", { name: "Системная", exact: true }).click()
    await expect(page.locator("html")).toHaveClass(/light/)
    await page.emulateMedia({ colorScheme: "dark" })
    await expect(page.locator("html")).toHaveClass(/dark/)
    await page.emulateMedia({ colorScheme: "light" })
    await expect(page.locator("html")).toHaveClass(/light/)

    await page.setViewportSize({ width: 375, height: 812 })
    await noOverflow(page)
    await page.getByRole("button", { name: "Показать или скрыть меню" }).click()
    await menu(page, "Язык")
    await page.screenshot({ path: `${screenshotDir}/menu-language-375.png`, animations: "disabled" })
    await page.getByRole("menuitemradio", { name: "English", exact: true }).click()
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    // The mobile drawer stays open while changing a preference.
    await menu(page, "Theme")
    await page.screenshot({ path: `${screenshotDir}/menu-theme-375.png`, animations: "disabled" })
    await page.getByRole("menuitemradio", { name: "Dark", exact: true }).click()
    await expect(page.locator("html")).toHaveClass(/dark/)
    await page.keyboard.press("Escape")
    await noOverflow(page)
    await page.reload()
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    await expect(page.locator("html")).toHaveClass(/dark/)

    // Profile uses the same server preference and returning to system clears the explicit cookie.
    await page.getByRole("radiogroup", { name: "Language", exact: true }).getByRole("radio", { name: "System language", exact: true }).click()
    await expect.poll(async () => (await context.cookies()).some((c) => c.name === "bb_locale")).toBe(false)
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    const manifest = await context.request.get("/manifest.webmanifest")
    expect((await manifest.json()).lang).toBe("en")
    expect(errors).toEqual([])
  } finally { await context.close().catch(() => {}) }
})
