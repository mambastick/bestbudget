import { describe, expect, it } from "vitest"

import {
  getMemberPermissions,
  getRolePermissions,
  memberHasPermission,
  resolveSsoRoleMapping,
} from "./rbac"
import type { SsoRoleMapping, WorkspaceMember } from "./types"

describe("RBAC helpers", () => {
  it("derives role permissions and keeps invited members readless", () => {
    const ownerPermissions = getRolePermissions("owner")
    const adminPermissions = getRolePermissions("admin")
    const invitedMember: WorkspaceMember = {
      id: "member_invited",
      userId: "user_1",
      name: "Anna",
      email: "anna@example.com",
      role: "owner",
      status: "invited",
    }

    expect(ownerPermissions).toContain("manageSso")
    expect(adminPermissions).toContain("manageMembers")
    expect(adminPermissions).toContain("manageSso")
    expect(getMemberPermissions(invitedMember)).toEqual([])
  })

  it("merges explicit member permissions with role defaults", () => {
    const observer: WorkspaceMember = {
      id: "member_observer",
      userId: "user_1",
      name: "Anna",
      email: "anna@example.com",
      role: "observer",
      status: "active",
      permissions: ["createTransactions"],
    }

    expect(memberHasPermission(observer, "createTransactions")).toBe(true)
    expect(memberHasPermission(observer, "manageSso")).toBe(false)
  })

  it("resolves SSO role mappings by workspace, claim, and priority", () => {
    const mappings: SsoRoleMapping[] = [
      {
        id: "mapping_domain",
        providerId: "provider_oidc",
        workspaceId: null,
        claim: "email_domain",
        value: "example.com",
        role: "member",
        priority: 5,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "mapping_group",
        providerId: "provider_oidc",
        workspaceId: "workspace_family",
        claim: "groups",
        value: "finance-admins",
        role: "admin",
        permissions: ["manageSso"],
        priority: 10,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "mapping_other_provider",
        providerId: "provider_other",
        workspaceId: "workspace_family",
        claim: "groups",
        value: "finance-admins",
        role: "owner",
        priority: 100,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ]

    const resolution = resolveSsoRoleMapping(mappings, {
      providerId: "provider_oidc",
      workspaceId: "workspace_family",
      email: "ANNA@example.com",
      groups: ["finance-admins"],
    })

    expect(resolution).toMatchObject({
      role: "admin",
      mapping: { id: "mapping_group" },
    })
    expect(resolution?.permissions).toContain("manageMembers")
    expect(resolution?.permissions).toContain("manageSso")
    expect(
      resolveSsoRoleMapping(mappings, {
        providerId: "provider_oidc",
        workspaceId: "workspace_personal",
        email: "anna@example.com",
        groups: ["finance-admins"],
      })
    ).toMatchObject({
      role: "member",
      mapping: { id: "mapping_domain" },
    })
  })

  it("matches custom SSO claims", () => {
    const mapping: SsoRoleMapping = {
      id: "mapping_claim",
      providerId: "provider_oidc",
      workspaceId: null,
      claim: "claim",
      claimName: "tenant_role",
      value: "budget-owner",
      role: "owner",
      priority: 1,
      createdAt: "2026-06-01T00:00:00.000Z",
    }

    expect(
      resolveSsoRoleMapping([mapping], {
        providerId: "provider_oidc",
        claims: { tenant_role: ["budget-owner"] },
      })
    ).toMatchObject({
      role: "owner",
    })
  })
})
