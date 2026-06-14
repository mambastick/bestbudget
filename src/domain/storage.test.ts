import { describe, expect, it } from "vitest"

import { categoryPresets } from "./presets"
import {
  createEmptyDatabase,
  createWorkspaceForUser,
  loginAccount,
  normalizeDatabase,
  registerAccount,
} from "./storage"

describe("account and workspace smoke flow", () => {
  it("registers a user, creates a workspace with presets, and restores it on login", async () => {
    const registered = await registerAccount(createEmptyDatabase(), {
      name: "  Anna Budget  ",
      email: "ANNA@example.COM ",
      password: "secret1",
    })

    expect(registered.ok).toBe(true)
    if (!registered.ok) {
      throw new Error(registered.error)
    }

    expect(registered.db.users).toHaveLength(1)
    expect(registered.db.users[0]).toMatchObject({
      name: "Anna Budget",
      email: "anna@example.com",
    })
    expect(registered.session.activeWorkspaceId).toBeNull()

    const withWorkspace = createWorkspaceForUser(
      registered.db,
      registered.db.users[0],
      {
        name: " Family budget ",
        accessMode: "shared",
        currencyCode: "RUB",
      }
    )
    const workspace = withWorkspace.workspaces[0]

    expect(workspace).toMatchObject({
      name: "Family budget",
      accessMode: "shared",
      currencyCode: "RUB",
      ownerId: registered.db.users[0].id,
    })
    expect(workspace.members[0]).toMatchObject({
      userId: registered.db.users[0].id,
      role: "owner",
      status: "active",
    })
    expect(withWorkspace.session).toMatchObject({
      userId: registered.db.users[0].id,
      activeWorkspaceId: workspace.id,
    })
    expect(withWorkspace.categories).toHaveLength(categoryPresets.length)
    expect(
      withWorkspace.categories.every(
        (category) => category.workspaceId === workspace.id && !category.custom
      )
    ).toBe(true)

    const loggedOut = { ...withWorkspace, session: null }
    const loggedIn = await loginAccount(loggedOut, {
      email: " anna@example.com ",
      password: "secret1",
    })

    expect(loggedIn.ok).toBe(true)
    if (!loggedIn.ok) {
      throw new Error(loggedIn.error)
    }
    expect(loggedIn.session.activeWorkspaceId).toBe(workspace.id)
  })

  it("rejects invalid registration data, duplicate email, and wrong password", async () => {
    await expect(
      registerAccount(createEmptyDatabase(), {
        name: "",
        email: "bad@example.com",
        password: "12345",
      })
    ).resolves.toMatchObject({
      ok: false,
      error: "Укажите имя, корректный email и пароль не короче 6 символов.",
    })

    const registered = await registerAccount(createEmptyDatabase(), {
      name: "Anna",
      email: "anna@example.com",
      password: "secret1",
    })

    expect(registered.ok).toBe(true)
    if (!registered.ok) {
      throw new Error(registered.error)
    }

    await expect(
      registerAccount(registered.db, {
        name: "Another Anna",
        email: "ANNA@example.com",
        password: "secret1",
      })
    ).resolves.toMatchObject({
      ok: false,
      error: "Аккаунт с таким email уже существует.",
    })

    await expect(
      loginAccount(registered.db, {
        email: "anna@example.com",
        password: "wrong-password",
      })
    ).resolves.toMatchObject({
      ok: false,
      error: "Неверный пароль.",
    })
  })
})

describe("database normalization", () => {
  it("falls back to safe empty collections and requires a valid session user", () => {
    expect(
      normalizeDatabase({
        users: "not-an-array",
        workspaces: null,
        categories: [{ id: "category_1" }],
        session: { activeWorkspaceId: "workspace_1" },
      })
    ).toMatchObject({
      version: 1,
      users: [],
      workspaces: [],
      categories: [],
      transactions: [],
      budgets: [],
      liabilities: [],
      documents: [],
      session: null,
    })
  })
})
