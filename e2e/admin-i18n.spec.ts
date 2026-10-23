import { test, expect, seedDemo, withDb, screenshot, type StorageState } from "./matrix"

const demo = { name: "Алексей Demo Admin" }
const routes = ["users", "households", "auth", "rates", "events", "notifications"] as const
const stamp = "2050-12-31T23:30:00Z"
const familyTimeZone = "Europe/Moscow"
const screenshots = "docs/screenshots/i18n/admin"
let state: StorageState
let userId: string

test.use({ serviceWorkers: "block", colorScheme: "light", reducedMotion: "reduce" })
test.setTimeout(60_000)

test.beforeAll(async ({ browser }) => {
  const seeded = await seedDemo(browser, "admin-locale", demo.name)
  state = seeded.state
  userId = seeded.id
  await withDb(async (sql) => {
    const [profile] = await sql`select locale, last_seen_locale from users where id=${userId}`
    expect(profile).toMatchObject({ locale: null, last_seen_locale: "ru" })
    await sql`update sessions set updated_at = ${stamp} where user_id = ${userId}`
    await sql`update households set created_at = ${stamp} where id = ${seeded.household_id}`
    await sql`insert into notification_settings (id, last_update_at) values (1, ${stamp}) on conflict (id) do update set last_update_at = excluded.last_update_at`
    await sql`insert into audit_logs (actor_id, action, entity_type, created_at) values (${userId}, 'auth.sign_in', 'user', ${stamp})`
    await sql`insert into invitations (household_id, token_hash, role, note, expires_at) values (${seeded.household_id}, ${`synthetic-timezone-invite-${userId}`}, 'member', 'Timezone fixture', ${stamp})`
    // The admin view is global; replace only this fixture's previous delivery after a worker restart.
    await sql`delete from notification_deliveries where dedupe_key='synthetic-locale-error'`
    await sql`insert into notification_deliveries (user_id, household_id, channel, kind, dedupe_key, status, error, created_at) select ${userId}, household_id, 'telegram', 'due', 'synthetic-locale-error', 'unknown', 'delivery_unknown', ${stamp}::timestamptz from household_members where user_id = ${userId} limit 1`
  })
})

test.beforeEach(async ({ context }) => {
  await context.addCookies(state.cookies)
  await withDb(async (sql) => { await sql`update users set locale=null where id=${userId}` })
})

for (const locale of ["ru", "en"] as const) {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1280, 375]) {
      test(`administration: ${locale}, ${theme}, ${width}px`, async ({ page }) => {
        await withDb(async (sql) => {
          await sql`update users set locale=${locale} where id=${userId}`
          const expectedStamp = new Intl.DateTimeFormat(locale, { timeZone: familyTimeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(stamp))
          await page.setViewportSize({ width, height: 900 })
          await page.addInitScript((value) => localStorage.setItem("theme", value), theme)
          for (const tab of routes) {
            await page.goto(`/admin?tab=${tab}`)
            await expect(page).toHaveTitle(`${locale === "ru" ? "Администрирование" : "Administration"} · BestBudget`)
            await expect(page.locator("html")).toHaveClass(new RegExp(theme))
            await expect(page.getByRole("heading", { name: locale === "ru" ? "Администрирование" : "Administration", exact: true })).toBeVisible()
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
            await expect(page.locator("nextjs-portal")).toHaveCount(0)
            if (["users", "households", "events", "notifications"].includes(tab)) {
              await expect(page.getByText(expectedStamp, { exact: false }).filter({ visible: true }).first()).toBeVisible()
            }
            if (tab === "users") await expect(page.getByText(demo.name, { exact: false }).first()).toBeVisible()
            if (tab === "notifications") {
              await expect(page.getByText(locale === "ru" ? "Ошибок пока нет" : "No errors yet")).toHaveCount(0)
              await expect(page.getByText(`${locale === "ru" ? "Последний апдейт" : "Last update"}: ${expectedStamp}`, { exact: true }).filter({ visible: true })).toBeVisible()
              await expect(page.getByText(expectedStamp, { exact: false }).filter({ visible: true })).toHaveCount(2)
            }
            if (locale === "en" && ((tab === "users" && theme === "light" && width === 1280) || (tab === "auth" && theme === "dark" && width === 375) || (tab === "notifications" && theme === "light" && width === 375))) {
              await screenshot(page, `${screenshots}/${tab}-en-${width}-${theme}.png`, tab !== "users")
            }
          }
        })
      })
    }
  }
}

for (const locale of ["ru", "en"] as const) {
  test(`administration: ${locale} preference and household timestamps`, async ({ page }) => {
    await withDb(async (sql) => {
      // Use the real preference action; browser fallback must be remembered separately.
      await page.goto("/settings?tab=profile")
      await page.getByRole("radiogroup", { name: "Язык", exact: true }).getByRole("radio", { name: locale === "ru" ? "Русский" : "English", exact: true }).click()
      await expect(page.locator("html")).toHaveAttribute("lang", locale)
      const expectedStamp = new Intl.DateTimeFormat(locale, { timeZone: familyTimeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(stamp))
      await expect(page.getByText(expectedStamp, { exact: false }).filter({ visible: true }).first()).toBeVisible()
      await page.goto("/settings?tab=household")
      await expect(page.getByText(expectedStamp, { exact: false }).filter({ visible: true }).first()).toBeVisible()
      const [saved] = await sql`select locale, last_seen_locale from users where id = ${userId}`
      expect(saved).toMatchObject({ locale, last_seen_locale: "ru" })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
    })
  })
}

test("administration: saved locale and browser language remain independent", async ({ browser, context, page }) => {
  await withDb(async (sql) => {
    await sql`update users set locale='en' where id=${userId}`
    await page.goto("/admin?tab=notifications")
    await page.waitForLoadState("networkidle")
    // Reuse the session in another browser language without signing in again.
    const englishContext = await browser.newContext({ locale: "en-US", storageState: await context.storageState() })
    try {
      const englishPage = await englishContext.newPage()
      await englishPage.goto("/admin?tab=notifications")
      await expect(englishPage.locator("html")).toHaveAttribute("lang", "en")
      await expect.poll(async () => {
        const [saved] = await sql`select locale, last_seen_locale from users where id=${userId}`
        return saved
      }).toMatchObject({ locale: "en", last_seen_locale: "en" })
    } finally { await englishContext.close() }
    await page.reload()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
    await expect(page.locator("html")).toHaveAttribute("lang", "en")
    await expect.poll(async () => {
      const [saved] = await sql`select locale, last_seen_locale from users where id=${userId}`
      return saved
    }).toMatchObject({ locale: "en", last_seen_locale: "ru" })
  })
})
