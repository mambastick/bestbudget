import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import type { BrowserContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures"
import { E2E_ENV } from "../playwright.config"

const user = { name: "PWA Demo", email: "pwa@e2e.test", password: "pwa-demo-password-1" }
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>>

async function ready(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
}

async function profile(page: Page) {
  await page.goto("/settings?tab=profile")
  await expect(page.getByRole("heading", { name: /^(Настройки|Settings)$/ })).toBeVisible()
}

const mobileOptions = {
  viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  locale: "ru-RU", timezoneId: "Europe/Moscow",
}

async function standalone(context: BrowserContext) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { get: () => true })
  })
}

async function safeInsets(page: Page) {
  // Chromium's iPhone emulation has zero native env() insets. Override their CSS aliases, not UA behavior.
  await page.addStyleTag({ content: `:root { --safe-top: 47px; --safe-bottom: 34px; --safe-left: 0px; --safe-right: 0px; }
    html.standalone::before { content: ''; position: fixed; z-index: 100; top: 0; left: calc(50% - 78px); width: 156px; height: 30px; border-radius: 0 0 18px 18px; background: #000; pointer-events: none; }
    html.standalone::after { content: ''; position: fixed; z-index: 100; bottom: 8px; left: calc(50% - 60px); width: 120px; height: 5px; border-radius: 3px; background: currentColor; pointer-events: none; }` })
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
}

test.beforeAll(async ({ browser }) => {
  execFileSync(process.execPath, ["--import", "tsx", "scripts/admin.ts", "create-admin"], {
    env: { ...process.env, ...E2E_ENV, ADMIN_NAME: user.name, ADMIN_EMAIL: user.email, ADMIN_PASSWORD: user.password },
    stdio: "pipe",
  })
  const context = await browser.newContext({ locale: "ru-RU" })
  const page = await context.newPage()
  await page.goto("/login")
  await page.getByLabel("E-mail").fill(user.email)
  await page.getByLabel("Пароль", { exact: true }).fill(user.password)
  await page.getByRole("button", { name: "Войти", exact: true }).click()
  await expect(page).toHaveURL(/\/(onboarding|dashboard)/)
  const fresh = page.url().includes("/onboarding")
  if (fresh) {
    await page.getByLabel("Название").fill("Демо семьи · PWA")
    await page.getByRole("button", { name: "Создать", exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard/)
  }
  await page.waitForLoadState("networkidle")
  cookies = await context.cookies()
  await context.close()
  if (!fresh) return
  execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/seed-demo.ts", user.email], {
    env: { ...process.env, ...E2E_ENV }, stdio: "pipe",
  })
})

test.beforeEach(async ({ context }) => { await context.addCookies(cookies) })

test("production manifest, public assets, build identity and global SW without push permission", async ({ page, context }) => {
  await page.addInitScript(() => {
    Notification.requestPermission = async () => {
      document.documentElement.dataset.notificationPrompted = "true"
      return "denied"
    }
  })
  await page.goto("/dashboard")
  await ready(page)
  await expect(page.locator("html")).not.toHaveAttribute("data-notification-prompted", "true")
  const manifest = await (await page.request.get("/manifest.webmanifest")).json()
  expect(manifest).toMatchObject({ id: "/dashboard", display: "standalone", display_override: ["standalone"], orientation: "any", categories: ["finance"], scope: "/" })
  expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(["/dashboard?new=transaction", "/calendar", "/transactions/import"])
  for (const asset of [...manifest.icons, ...manifest.screenshots]) {
    const response = await page.request.get(asset.src)
    expect(response.ok(), asset.src).toBe(true)
    expect(response.headers()["content-type"]).toMatch(/image\//)
    expect((await response.body()).length).toBeGreaterThan(100)
  }
  const version = await (await page.request.get("/sw-version.js")).text()
  expect(await (await page.request.get("/sw-version.js")).text()).toBe(version)
  const splash = page.locator('link[rel="apple-touch-startup-image"][media*="device-width: 375px"][media*="device-height: 812px"][media*="portrait"][media*="light"]')
  expect(await splash.count()).toBe(1)
  const response = await page.request.get((await splash.getAttribute("href"))!)
  expect(response.headers()["content-type"]).toContain("image/png")
  expect((await page.request.get("/pwa-splash?width=99999&height=99999&theme=dark")).status()).toBe(400)
  await page.goto("/api/health")
  await page.goto("/transactions")
  const cached = await page.evaluate(async () => {
    const result: string[] = []
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) result.push(new URL(request.url).pathname + new URL(request.url).search)
    return result.sort()
  })
  expect(cached).toEqual(["/offline/en", "/offline/ru", "/pwa-icon/192", "/pwa-icon/512", "/pwa-icon/512?maskable=1"])
  // Reopening a tab retains a persistent 30-day session; no separate app sign-in workaround is introduced.
  const sessionCookie = (await context.cookies()).find((c) => c.name.endsWith("session_token"))!
  expect(sessionCookie.expires - Date.now() / 1000).toBeGreaterThan(29 * 86400)
})

test("offline fallback uses selected locale/theme, retries the original URL and never supplies API data", async ({ page, context }) => {
  await profile(page)
  await page.getByRole("radio", { name: "English", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await page.getByRole("radio", { name: "Dark", exact: true }).click()
  await ready(page)
  await context.setOffline(true)
  await page.goto("/calendar?offline-test=1")
  await expect(page.getByRole("heading", { name: "No connection" })).toBeVisible()
  await expect(page.locator("html")).toHaveClass(/dark/)
  expect(await page.evaluate(() => fetch("/api/health").then(() => false, () => true))).toBe(true)
  await context.setOffline(false)
  await page.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(page).toHaveURL(/\/calendar\?offline-test=1/)
  await expect(page.getByRole("heading", { name: "No connection" })).toHaveCount(0)
  // Explicit Russian is also preserved independently of the worker's browser language.
  await profile(page)
  await page.getByRole("radio", { name: "Русский", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("lang", "ru")
  await context.setOffline(true)
  await page.getByRole("link", { name: "Календарь", exact: true }).first().click()
  await expect(page.getByRole("heading", { name: "Нет соединения" })).toBeVisible()
})

test("Chromium install prompt requires a click, is consumed once and appinstalled hides the controls", async ({ page }) => {
  await profile(page)
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true })
    Object.assign(event, { prompt: async () => { document.documentElement.dataset.prompted = "true" }, userChoice: Promise.resolve({ outcome: "accepted" }) })
    window.dispatchEvent(event)
    document.documentElement.dataset.prevented = String(event.defaultPrevented)
  })
  await expect(page.locator("html")).toHaveAttribute("data-prevented", "true")
  await expect(page.locator("html")).not.toHaveAttribute("data-prompted", "true")
  await page.getByRole("button", { name: "Установить приложение", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("data-prompted", "true")
  await page.getByRole("button", { name: "Установить приложение", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("Как установить BestBudget")
  await page.getByRole("button", { name: "Понятно" }).click()
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")))
  await expect(page.getByRole("button", { name: "Установить приложение", exact: true })).toHaveCount(0)
})

test("English install instructions use the PWA namespace at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await profile(page)
  await page.getByRole("radio", { name: "English", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("lang", "en")
  await page.getByRole("button", { name: "Install app", exact: true }).click()
  await expect(page.getByRole("dialog")).toContainText("How to install BestBudget")
  await noOverflow(page)
  await page.screenshot({ path: "docs/screenshots/pwa/install-en.png", animations: "disabled" })
  await page.getByRole("button", { name: "Got it", exact: true }).click()
  await page.getByRole("radio", { name: "Русский", exact: true }).click()
  await expect(page.locator("html")).toHaveAttribute("lang", "ru")
})

test("iOS Safari and Chrome instructions are accessible from the user menu and profile at 375px", async ({ browser }) => {
  for (const other of [false, true]) {
    const context = await browser.newContext({ ...mobileOptions, userAgent: other ? mobileOptions.userAgent.replace("Version/17.0", "CriOS/120.0") : mobileOptions.userAgent })
    await context.addCookies(cookies)
    const page = await context.newPage()
    await profile(page)
    if (other) {
      await page.getByRole("button", { name: "Показать или скрыть меню" }).click()
      await page.getByRole("button").filter({ hasText: user.email }).click()
      await page.getByRole("menuitem", { name: "Установить приложение", exact: true }).click()
    } else await page.getByRole("button", { name: "Установить приложение", exact: true }).click()
    await expect(page.getByRole("dialog").last()).toContainText(other ? "На iOS 16.4" : "В Safari")
    await noOverflow(page)
    await page.screenshot({ path: `docs/screenshots/pwa/install-ios${other ? "-chrome" : "-safari"}.png`, animations: "disabled" })
    await context.close()
  }
})

test("standalone iPhone: shortcut, parent navigation, safe insets, input size, themes and screenshots", async ({ browser }) => {
  await mkdir("docs/screenshots/pwa", { recursive: true })
  await mkdir("public/screenshots", { recursive: true })
  const context = await browser.newContext(mobileOptions)
  await context.addCookies(cookies)
  await standalone(context)
  const page = await context.newPage()
  for (const theme of ["light", "dark"]) {
    await profile(page)
    await page.getByRole("radio", { name: theme === "light" ? "Светлая" : "Тёмная", exact: true }).click()
    await expect(page.locator("html")).toHaveClass(new RegExp(theme))
    await expect(page.locator("html")).toHaveClass(/standalone/)
    await expect(page.getByRole("button", { name: "Установить приложение", exact: true })).toHaveCount(0)
    const meta = await page.locator('meta[name="theme-color"]').evaluateAll((nodes) => nodes.map((n) => n.getAttribute("content")))
    expect(new Set(meta).size).toBe(1)
    expect(meta[0]).toBe(theme === "light" ? "#f9fafb" : "#0a0c10")
    await page.getByRole("button", { name: "Назад", exact: true }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await page.goto("/dashboard?new=transaction")
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("Новая операция", { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/dashboard$/)
    await safeInsets(page)
    expect(await dialog.getByLabel("Сумма", { exact: true }).evaluate((e) => getComputedStyle(e).fontSize)).toBe("16px")
    const footer = dialog.locator('[data-slot="dialog-footer"]')
    await expect(footer).toHaveCSS("padding-bottom", "34px")
    await noOverflow(page)
    await page.screenshot({ path: `docs/screenshots/pwa/iphone-dialog-${theme}.png`, animations: "disabled" })
    await footer.scrollIntoViewIfNeeded()
    expect((await footer.boundingBox())!.y + (await footer.boundingBox())!.height).toBeLessThanOrEqual(812 - 34)
    await page.screenshot({ path: `docs/screenshots/pwa/iphone-footer-${theme}.png`, animations: "disabled" })
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('[data-slot="app-header"]')).toHaveCSS("padding-top", "47px")
    const fab = page.locator('[data-slot="transaction-fab"]')
    expect((await fab.boundingBox())!.y + (await fab.boundingBox())!.height).toBeLessThanOrEqual(812 - 34)
    await noOverflow(page)
    await page.screenshot({ path: `docs/screenshots/pwa/iphone-${theme}.png`, animations: "disabled" })

    await page.getByRole("button", { name: "Показать или скрыть меню" }).click()
    await expect(page.locator('[data-slot="sidebar-footer"]')).toHaveCSS("padding-bottom", "34px")
    await page.screenshot({ path: `docs/screenshots/pwa/iphone-sidebar-${theme}.png`, animations: "disabled" })
    await page.keyboard.press("Escape")
  }
  await context.close()
  const mobile = await browser.newContext(mobileOptions)
  await mobile.addCookies(cookies)
  const narrow = await mobile.newPage()
  await narrow.emulateMedia({ reducedMotion: "reduce" })
  await narrow.goto("/dashboard")
  await expect(narrow.getByTestId("actual-balance").filter({ visible: true })).toBeVisible()
  await narrow.screenshot({ path: "public/screenshots/dashboard-narrow.png", animations: "disabled" })
  await mobile.close()
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ru-RU" })
  await desktop.addCookies(cookies)
  const wide = await desktop.newPage()
  await wide.emulateMedia({ reducedMotion: "reduce" })
  await wide.goto("/dashboard")
  await wide.evaluate(() => localStorage.setItem("theme", "light"))
  await wide.reload()
  await expect(wide.locator("html")).toHaveClass(/light/)
  await expect(wide.getByTestId("actual-balance").filter({ visible: true })).toBeVisible()
  await wide.waitForLoadState("networkidle")
  await wide.screenshot({ path: "public/screenshots/dashboard-wide.png", animations: "disabled" })
  await desktop.close()
  const signedOut = await browser.newContext(mobileOptions)
  await standalone(signedOut)
  const login = await signedOut.newPage()
  await login.goto("/login")
  await safeInsets(login)
  await expect(login.locator('[data-slot="auth-preferences"]')).toHaveCSS("top", "59px")
  await expect(login.getByLabel("E-mail")).toHaveCSS("font-size", "16px")
  await noOverflow(login)
  await login.screenshot({ path: "docs/screenshots/pwa/iphone-login.png", animations: "disabled" })
  await signedOut.close()
})

test("a waiting update preserves forms in both tabs and reloads only after confirmation", async ({ page, context }) => {
  await profile(page)
  await ready(page)
  const second = await context.newPage()
  await profile(second)
  await second.getByLabel("Имя", { exact: true }).fill("Unsaved second tab")
  await page.getByLabel("Имя", { exact: true }).fill("Unsaved first tab")
  const swPath = ".next/standalone/public/sw.js"
  const original = await readFile(swPath, "utf8")
  try {
    await writeFile(swPath, original + "\n// e2e update probe\n")
    await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update() })
    await expect(page.getByText("Доступна новая версия BestBudget", { exact: true })).toBeVisible()
    await expect(page.getByLabel("Имя", { exact: true })).toHaveValue("Unsaved first tab")
    await page.getByRole("button", { name: "Обновить", exact: true }).click()
    await expect(page.getByLabel("Имя", { exact: true })).toHaveValue(user.name)
    await expect(second.getByText("Доступна новая версия BestBudget", { exact: true })).toBeVisible()
    await expect(second.getByLabel("Имя", { exact: true })).toHaveValue("Unsaved second tab")
  } finally { await writeFile(swPath, original) }
})
