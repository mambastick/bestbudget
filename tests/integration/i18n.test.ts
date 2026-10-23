import { afterAll, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { eq } from "drizzle-orm"
import { users } from "@/db/schema"
import { closeDb, getDb } from "@/db"
import { setUserLocale, getUserLocale, getRecipientLocale, rememberBrowserLocale } from "@/server/services/preferences"
import { createHousehold, resolveHouseholdCtx } from "@/server/services/households"
import { listCategories, listAccounts } from "@/server/services/catalog"
import { AppError, runAction } from "@/server/errors"
import { categoryInput } from "@/server/services/catalog"
import { createUser } from "./helpers"

const requestLocale = vi.hoisted(() => ({ value: "ru" }))
vi.mock("next-intl/server", () => ({ getLocale: async () => { if (requestLocale.value === "broken") throw new Error("Preference unavailable"); return requestLocale.value } }))
afterAll(closeDb)

describe("locale preference persistence", () => {
  it("keeps existing/new users on system and updates only the current user's preference", async () => {
    const user = await createUser()
    const other = await createUser()
    expect(await getUserLocale(user.id)).toBeNull()
    await setUserLocale(user.id, "en")
    expect(await getUserLocale(user.id)).toBe("en")
    expect(await getUserLocale(other.id)).toBeNull()
    await setUserLocale(user.id, "ru")
    expect(await getUserLocale(user.id)).toBe("ru")
    await expect(setUserLocale(user.id, "de" as never)).rejects.toThrow()
    expect(await getUserLocale(user.id)).toBe("ru")
    await setUserLocale(user.id, null)
    expect(await getUserLocale(user.id)).toBeNull()
  })

  it("remembers browser language for recipients while explicit preference takes priority", async () => {
    const user = await createUser()
    const other = await createUser()
    expect(await getRecipientLocale(user.id)).toBe("en")
    await rememberBrowserLocale(user.id, "ru")
    expect(await getRecipientLocale(user.id)).toBe("ru")
    await setUserLocale(user.id, "en")
    expect(await getRecipientLocale(user.id)).toBe("en")
    await setUserLocale(user.id, null)
    expect(await getRecipientLocale(user.id)).toBe("ru")
    await rememberBrowserLocale(user.id, "en")
    expect(await getRecipientLocale(user.id)).toBe("en")
    const [profile] = await getDb().select().from(users).where(eq(users.id, other.id))
    expect(profile).toMatchObject({ locale: null, lastSeenLocale: null })
    await expect(rememberBrowserLocale(user.id, "de" as never)).rejects.toThrow()
  })

  it("does not write unchanged browser language and updates it when the browser changes", async () => {
    const user = await createUser()
    await rememberBrowserLocale(user.id, "ru")
    const [before] = await getDb().select().from(users).where(eq(users.id, user.id))
    vi.setSystemTime(Date.now() + 60_000)
    await rememberBrowserLocale(user.id, "ru")
    const [same] = await getDb().select().from(users).where(eq(users.id, user.id))
    expect(same!.updatedAt).toEqual(before!.updatedAt)
    await rememberBrowserLocale(user.id, "en")
    const [changed] = await getDb().select().from(users).where(eq(users.id, user.id))
    expect(changed!.updatedAt.getTime()).toBeGreaterThan(same!.updatedAt.getTime())
    expect(changed!.lastSeenLocale).toBe("en")
  })

  it("seeds names in the creator's locale and never renames existing data", async () => {
    const user = await createUser()
    const household = await createHousehold(user.id, { name: "Test" }, "en")
    const ctx = (await resolveHouseholdCtx(user.id, household.id))!
    expect((await listCategories(ctx)).some((c) => c.name === "Groceries")).toBe(true)
    expect((await listAccounts(ctx))[0]?.name).toBe("Main account")
    await setUserLocale(user.id, "ru")
    expect((await listCategories(ctx)).some((c) => c.name === "Groceries")).toBe(true)
  })
})

describe("localized ActionResult", () => {
  it.each(["ru", "en"])("translates AppError and Zod issues for %s without changing the contract", async (locale) => {
    requestLocale.value = locale
    const result = await runAction(async () => { throw new AppError("category.inUse") })
    expect(result).toEqual({ ok: false, error: locale === "ru" ? "Категория используется в операциях. Архивируйте её — история сохранится." : "This category is used in transactions. Archive it to keep its history." })
    const parametrized = await runAction(async () => { throw new AppError("import.undoBlocked", { rows: "7", removed: "—", shared: "—", changed: "7", count: 2 }) })
    expect(parametrized.ok).toBe(false)
    if (!parametrized.ok) expect(parametrized.error).toContain(locale === "ru" ? "2 блокировки" : "2 blockers")
    const invalid = await runAction(async () => categoryInput.parse({ kind: "expense", name: "", icon: "circle", color: "bad" }))
    expect(invalid).toMatchObject({ ok: false, fieldErrors: { name: locale === "ru" ? "Укажите название" : "Enter a name", color: locale === "ru" ? "Некорректный цвет" : "Invalid color" } })
    const builtin = await runAction(async () => z.object({ value: z.string() }).parse({ value: 42 }))
    if (!builtin.ok) expect(builtin.error).toBe(locale === "ru" ? "Некорректный тип значения" : "Invalid value type")
    expect(await runAction(async () => 42)).toEqual({ ok: true, data: 42 })
  })
})

it("keeps ActionResult safe when preference resolution and the action both fail", async () => {
  requestLocale.value = "broken"
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    expect(await runAction(async () => { throw new Error("private input must not be logged") })).toEqual({ ok: false, error: "Something went wrong. Please try again." })
    expect(log).toHaveBeenCalledExactlyOnceWith("[action] unexpected error: Error")
  } finally { log.mockRestore(); requestLocale.value = "ru" }
})
