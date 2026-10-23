import { afterAll, describe, expect, it } from "vitest"
import { closeDb } from "@/db"
import { createCategory, listAccounts, listCategories } from "@/server/services/catalog"
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  findValidInvitation,
  listMembers,
  removeMember,
  resolveHouseholdCtx,
  revokeInvitation,
} from "@/server/services/households"
import { createRules, getRule } from "@/server/services/recurring"
import { getDashboard } from "@/server/services/reports"
import { createTransaction, deleteTransaction, getTransaction, listTransactions, updateTransaction } from "@/server/services/transactions"
import { setBudget } from "@/server/services/budgets"
import { createUser, setupHousehold } from "./helpers"

afterAll(async () => {
  await closeDb()
})

describe("household creation", () => {
  it("seeds default categories and an account", async () => {
    const { ctx } = await setupHousehold()
    const cats = await listCategories(ctx)
    expect(cats.filter((c) => c.kind === "income")).toHaveLength(8)
    expect(cats.filter((c) => c.kind === "expense")).toHaveLength(17)
    expect(await listAccounts(ctx)).toHaveLength(1)
    expect(ctx.timezone).toBe("Europe/Moscow")
    expect(ctx.role).toBe("owner")
  })
})

describe("invitations", () => {
  it("invites a spouse who then shares the budget", async () => {
    const { ctx, cat, mainAccount } = await setupHousehold()
    const { token } = await createInvitation(ctx, { role: "member" })
    expect(await findValidInvitation(token)).toMatchObject({ householdId: ctx.householdId })

    const spouse = await createUser("Spouse")
    expect(await resolveHouseholdCtx(spouse.id, ctx.householdId)).toBeNull()
    await acceptInvitation(spouse.id, token)
    const spouseCtx = (await resolveHouseholdCtx(spouse.id, ctx.householdId))!
    expect(spouseCtx.role).toBe("member")

    // The spouse adds an expense; the owner sees it with its author.
    await createTransaction(spouseCtx, { type: "expense", amount: 70_000, categoryId: cat("Продукты"), accountId: mainAccount, date: "2026-10-01", status: "posted" })
    const { rows } = await listTransactions(ctx, {})
    expect(rows).toHaveLength(1)
    expect(rows[0]!.authorName).toBe("Spouse")
    expect((await listMembers(ctx)).map((m) => m.role).sort()).toEqual(["member", "owner"])
  })

  it("tokens are single-use and can be revoked", async () => {
    const { ctx } = await setupHousehold()
    const { token } = await createInvitation(ctx, {})
    await acceptInvitation((await createUser()).id, token)
    await expect(acceptInvitation((await createUser()).id, token)).rejects.toThrow(/недействительно/)
    expect(await findValidInvitation(token)).toBeNull()

    const second = await createInvitation(ctx, {})
    await revokeInvitation(ctx, second.id)
    await expect(acceptInvitation((await createUser()).id, second.token)).rejects.toThrow(/недействительно/)
  })

  it("concurrent acceptance consumes the token only once", async () => {
    const { ctx } = await setupHousehold()
    const { token } = await createInvitation(ctx, {})
    const [u1, u2] = [await createUser(), await createUser()]
    const results = await Promise.allSettled([acceptInvitation(u1.id, token), acceptInvitation(u2.id, token)])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(await listMembers(ctx)).toHaveLength(2)
  })

  it("rejects garbage tokens", async () => {
    expect(await findValidInvitation("nope")).toBeNull()
    await expect(acceptInvitation((await createUser()).id, "nope")).rejects.toThrow()
  })
})

describe("household isolation", () => {
  it("a user cannot resolve a context for someone else's household", async () => {
    const a = await setupHousehold()
    const b = await setupHousehold()
    expect(await resolveHouseholdCtx(b.owner.id, a.ctx.householdId)).toBeNull()
    expect(await resolveHouseholdCtx(b.owner.id, "not-a-uuid")).toBeNull()
  })

  it("ids from another household are not found, even with a valid context", async () => {
    const a = await setupHousehold()
    const b = await setupHousehold()
    const t = await createTransaction(a.ctx, { type: "expense", amount: 100, categoryId: a.cat("Продукты"), accountId: a.mainAccount, date: "2026-10-01", status: "posted" })
    const [rule] = await createRules(a.ctx, {
      rule: { type: "expense", title: "x", amount: 1, categoryId: a.cat("Подписки"), accountId: a.mainAccount, frequency: "monthly", dayOfMonth: 1, startDate: "2030-01-01" },
    })

    await expect(getTransaction(b.ctx, t.id)).rejects.toThrow(/не найдена/)
    await expect(deleteTransaction(b.ctx, t.id)).rejects.toThrow(/не найдена/)
    await expect(
      updateTransaction(b.ctx, t.id, { type: "expense", amount: 1, categoryId: b.cat("Продукты"), accountId: b.mainAccount, date: "2026-10-01", status: "posted", version: 1 }),
    ).rejects.toThrow(/не найдена/)
    await expect(getRule(b.ctx, rule!.id)).rejects.toThrow(/не найдено/)
    // Referencing another household's account or category is rejected.
    await expect(
      createTransaction(b.ctx, { type: "expense", amount: 1, categoryId: a.cat("Продукты"), accountId: b.mainAccount, date: "2026-10-01", status: "posted" }),
    ).rejects.toThrow(/не найдена/)
    await expect(
      createTransaction(b.ctx, { type: "expense", amount: 1, categoryId: b.cat("Продукты"), accountId: a.mainAccount, date: "2026-10-01", status: "posted" }),
    ).rejects.toThrow(/не найден/)

    expect((await listTransactions(b.ctx, {})).rows).toHaveLength(0)
    expect((await getDashboard(b.ctx, "2026-10-01")).monthExpense).toBe(0)
  })
})

describe("role permissions", () => {
  it("members manage operations but not catalog, invitations or members", async () => {
    const { ctx, cat } = await setupHousehold()
    const member = await createUser("Member")
    await acceptInvitation(member.id, (await createInvitation(ctx, { role: "member" })).token)
    const mctx = (await resolveHouseholdCtx(member.id, ctx.householdId))!

    await expect(createCategory(mctx, { kind: "expense", name: "Хобби", icon: "circle", color: "#64748b" })).rejects.toThrow(/Недостаточно прав/)
    await expect(createInvitation(mctx, {})).rejects.toThrow(/Недостаточно прав/)
    await expect(setBudget(mctx, { categoryId: cat("Продукты"), amount: 100 })).rejects.toThrow(/Недостаточно прав/)
    await expect(removeMember(mctx, ctx.userId)).rejects.toThrow(/Недостаточно прав/)
  })

  it("admins manage catalog and invitations but not members; the owner cannot be removed", async () => {
    const { ctx, cat } = await setupHousehold()
    const admin = await createUser("Admin")
    await acceptInvitation(admin.id, (await createInvitation(ctx, { role: "admin" })).token)
    const actx = (await resolveHouseholdCtx(admin.id, ctx.householdId))!

    await createCategory(actx, { kind: "expense", name: "Хобби", icon: "circle", color: "#64748b" })
    await setBudget(actx, { categoryId: cat("Продукты"), amount: 3_000_000 })
    await createInvitation(actx, {})
    await expect(changeMemberRole(actx, ctx.userId, "member")).rejects.toThrow(/Недостаточно прав/)
    await expect(removeMember(ctx, ctx.userId)).rejects.toThrow(/Владелец не может/)

    // Owner can demote and remove; a removed member loses access immediately.
    await changeMemberRole(ctx, admin.id, "member")
    await removeMember(ctx, admin.id)
    expect(await resolveHouseholdCtx(admin.id, ctx.householdId)).toBeNull()
  })
})
