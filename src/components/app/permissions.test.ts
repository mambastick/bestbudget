import { describe, expect, it } from "vitest"

import {
  getWorkspaceMember,
  getWorkspacePermissions,
  noWorkspacePermissions,
  type WorkspacePermission,
} from "./permissions"
import type { User, Workspace, WorkspaceMember } from "@/domain/types"

const user = {
  id: "user_active",
  name: "Anna",
  email: "anna@example.com",
  passwordHash: "hash",
  createdAt: "2026-06-01T00:00:00.000Z",
} satisfies User

function createWorkspace(member: WorkspaceMember): Workspace {
  return {
    id: "workspace_family",
    name: "Family",
    accessMode: "shared",
    currencyCode: "RUB",
    ownerId: "user_owner",
    createdAt: "2026-06-01T00:00:00.000Z",
    members: [member],
  }
}

function createMember(
  role: WorkspaceMember["role"],
  status: WorkspaceMember["status"] = "active"
): WorkspaceMember {
  return {
    id: `member_${role}_${status}`,
    userId: user.id,
    name: user.name,
    email: user.email,
    role,
    status,
  }
}

const permissions = [
  "createTransactions",
  "manageBudgets",
  "manageLiabilities",
  "manageDocuments",
  "manageMembers",
  "manageSso",
] satisfies WorkspacePermission[]

describe("workspace permission enforcement", () => {
  it("maps each workspace role to the expected permission set", () => {
    expect(getWorkspacePermissions(user, createWorkspace(createMember("owner")))).toEqual({
      createTransactions: true,
      manageBudgets: true,
      manageLiabilities: true,
      manageDocuments: true,
      manageMembers: true,
      manageSso: true,
    })
    expect(getWorkspacePermissions(user, createWorkspace(createMember("admin")))).toEqual({
      createTransactions: true,
      manageBudgets: true,
      manageLiabilities: true,
      manageDocuments: true,
      manageMembers: true,
      manageSso: true,
    })
    expect(getWorkspacePermissions(user, createWorkspace(createMember("member")))).toEqual({
      createTransactions: true,
      manageBudgets: false,
      manageLiabilities: true,
      manageDocuments: true,
      manageMembers: false,
      manageSso: false,
    })
    expect(getWorkspacePermissions(user, createWorkspace(createMember("observer")))).toEqual(
      noWorkspacePermissions
    )
  })

  it("grants no permissions without an active matching membership", () => {
    const invitedWorkspace = createWorkspace(createMember("owner", "invited"))
    const otherUserWorkspace = createWorkspace({
      ...createMember("owner"),
      userId: "user_other",
    })

    expect(getWorkspaceMember(user, invitedWorkspace)).toBeNull()
    expect(getWorkspacePermissions(user, invitedWorkspace)).toEqual(
      noWorkspacePermissions
    )
    expect(getWorkspaceMember(user, otherUserWorkspace)).toBeNull()
    expect(getWorkspacePermissions(user, otherUserWorkspace)).toEqual(
      noWorkspacePermissions
    )
    expect(getWorkspacePermissions(null, createWorkspace(createMember("owner")))).toEqual(
      noWorkspacePermissions
    )
    expect(getWorkspacePermissions(user, null)).toEqual(noWorkspacePermissions)
  })

  it("returns a stable permission shape for denied checks", () => {
    expect(Object.keys(noWorkspacePermissions)).toEqual(permissions)
    expect(Object.values(noWorkspacePermissions).every((value) => value === false)).toBe(
      true
    )
  })
})
