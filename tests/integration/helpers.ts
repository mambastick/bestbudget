import { randomUUID } from "node:crypto"
import { getDb } from "@/db"
import { users } from "@/db/schema"
import type { HouseholdCtx } from "@/server/context"
import { createHousehold, resolveHouseholdCtx } from "@/server/services/households"
import { listAccounts, listCategories } from "@/server/services/catalog"

export async function createUser(name = "User") {
  const [u] = await getDb()
    .insert(users)
    .values({ name, email: `${randomUUID()}@example.test` })
    .returning()
  return u!
}

/** A user with a fresh household; returns the owner context and catalog lookups. */
export async function setupHousehold(name = "Семья") {
  const owner = await createUser("Owner")
  const household = await createHousehold(owner.id, { name })
  const ctx = (await resolveHouseholdCtx(owner.id, household.id))!
  return { owner, household, ctx, ...(await catalog(ctx)) }
}

export async function catalog(ctx: HouseholdCtx) {
  const cats = await listCategories(ctx)
  const accounts = await listAccounts(ctx)
  const cat = (name: string) => {
    const c = cats.find((x) => x.name === name)
    if (!c) throw new Error(`no category ${name}`)
    return c.id
  }
  return { cat, mainAccount: accounts[0]!.id }
}
