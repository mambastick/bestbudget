import { describe, expect, it } from "vitest"

import {
  getActiveWorkspace,
  getCurrentUser,
  getUserWorkspaces,
  getWorkspaceBudgets,
  getWorkspaceCategories,
  getWorkspaceLiabilities,
  getWorkspaceTransactions,
  matchesSearch,
  summarizeWorkspace,
} from "./selectors"
import type { AppDatabase } from "./types"

const db = {
  version: 1,
  users: [
    {
      id: "user_1",
      name: "Anna",
      email: "anna@example.com",
      passwordHash: "hash",
      createdAt: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "user_2",
      name: "Boris",
      email: "boris@example.com",
      passwordHash: "hash",
      createdAt: "2026-06-01T00:00:00.000Z",
    },
  ],
  workspaces: [
    {
      id: "workspace_family",
      name: "Family",
      accessMode: "shared",
      currencyCode: "RUB",
      ownerId: "user_1",
      createdAt: "2026-06-01T00:00:00.000Z",
      members: [
        {
          id: "member_1",
          userId: "user_1",
          name: "Anna",
          email: "anna@example.com",
          role: "owner",
          status: "active",
        },
        {
          id: "member_2",
          userId: "user_2",
          name: "Boris",
          email: "boris@example.com",
          role: "member",
          status: "invited",
        },
      ],
    },
    {
      id: "workspace_personal",
      name: "Personal",
      accessMode: "individual",
      currencyCode: "USD",
      ownerId: "user_2",
      createdAt: "2026-06-01T00:00:00.000Z",
      members: [
        {
          id: "member_3",
          userId: "user_2",
          name: "Boris",
          email: "boris@example.com",
          role: "owner",
          status: "active",
        },
      ],
    },
  ],
  categories: [
    {
      id: "category_income",
      workspaceId: "workspace_family",
      name: "Доход",
      kind: "income",
      icon: "money",
      color: "blue",
      custom: false,
    },
    {
      id: "category_food",
      workspaceId: "workspace_family",
      name: "Еда",
      kind: "expense",
      icon: "food",
      color: "orange",
      custom: false,
    },
    {
      id: "category_other_workspace",
      workspaceId: "workspace_personal",
      name: "Personal category",
      kind: "expense",
      icon: "card",
      color: "gray",
      custom: false,
    },
  ],
  transactions: [
    {
      id: "transaction_income",
      workspaceId: "workspace_family",
      title: "Salary",
      account: "Main card",
      categoryId: "category_income",
      type: "income",
      amount: 120000,
      date: "2026-06-05",
    },
    {
      id: "transaction_food",
      workspaceId: "workspace_family",
      title: "Groceries",
      account: "Main card",
      categoryId: "category_food",
      type: "expense",
      amount: 35000,
      date: "2026-06-06",
    },
    {
      id: "transaction_personal",
      workspaceId: "workspace_personal",
      title: "Other workspace expense",
      account: "Cash",
      categoryId: "category_other_workspace",
      type: "expense",
      amount: 500,
      date: "2026-06-07",
    },
  ],
  budgets: [
    {
      id: "budget_food",
      workspaceId: "workspace_family",
      categoryId: "category_food",
      limit: 40000,
      period: "month",
    },
  ],
  liabilities: [
    {
      id: "liability_mortgage",
      workspaceId: "workspace_family",
      title: "Mortgage",
      balance: 3000000,
      monthlyPayment: 45000,
      rate: 8.5,
      nextPayment: "2026-06-20",
    },
  ],
  documents: [],
  session: {
    userId: "user_1",
    activeWorkspaceId: "workspace_family",
  },
} satisfies AppDatabase

describe("workspace selectors", () => {
  it("keeps all finance data scoped to the active workspace", () => {
    const currentUser = getCurrentUser(db)
    const activeWorkspace = getActiveWorkspace(db, db.session)

    expect(currentUser?.id).toBe("user_1")
    expect(activeWorkspace?.id).toBe("workspace_family")
    expect(getUserWorkspaces(db, "user_1").map((workspace) => workspace.id)).toEqual([
      "workspace_family",
    ])
    expect(getUserWorkspaces(db, "user_2").map((workspace) => workspace.id)).toEqual([
      "workspace_personal",
    ])
    expect(getWorkspaceCategories(db, activeWorkspace?.id).map((item) => item.id)).toEqual([
      "category_income",
      "category_food",
    ])
    expect(
      getWorkspaceTransactions(db, activeWorkspace?.id).map((item) => item.id)
    ).toEqual(["transaction_income", "transaction_food"])
    expect(getWorkspaceBudgets(db, activeWorkspace?.id).map((item) => item.id)).toEqual([
      "budget_food",
    ])
    expect(
      getWorkspaceLiabilities(db, activeWorkspace?.id).map((item) => item.id)
    ).toEqual(["liability_mortgage"])
  })

  it("returns empty collections when workspace is not selected", () => {
    expect(getActiveWorkspace(db, null)).toBeNull()
    expect(getWorkspaceCategories(db, null)).toEqual([])
    expect(getWorkspaceTransactions(db, undefined)).toEqual([])
    expect(getWorkspaceBudgets(db, "")).toEqual([])
    expect(getWorkspaceLiabilities(db, null)).toEqual([])
  })
})

describe("budget summary and search", () => {
  it("calculates cash balance and monthly debt from workspace data", () => {
    const transactions = getWorkspaceTransactions(db, "workspace_family")
    const budgets = getWorkspaceBudgets(db, "workspace_family")
    const liabilities = getWorkspaceLiabilities(db, "workspace_family")

    expect(
      summarizeWorkspace({
        transactions,
        budgets,
        liabilities,
      })
    ).toEqual({
      income: 120000,
      expense: 35000,
      balance: 85000,
      monthlyDebt: 45000,
      budgetCount: 1,
    })
  })

  it("matches search across text and numeric values case-insensitively", () => {
    expect(matchesSearch(["Groceries", "Main card", 35000], "grocer")).toBe(true)
    expect(matchesSearch(["Groceries", "Main card", 35000], "35000")).toBe(true)
    expect(matchesSearch(["Groceries", "Main card"], "  MAIN  ")).toBe(true)
    expect(matchesSearch(["Groceries", "Main card"], "")).toBe(true)
    expect(matchesSearch(["Groceries", "Main card"], "salary")).toBe(false)
  })
})
