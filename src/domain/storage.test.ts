import { describe, expect, it } from "vitest"

import { categoryPresets } from "./presets"
import {
  completeSsoLogin,
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

  it("rejects unknown accounts and does not select invited-only workspaces on login", async () => {
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
      loginAccount(registered.db, {
        email: "missing@example.com",
        password: "secret1",
      })
    ).resolves.toMatchObject({
      ok: false,
      error: "Аккаунт не найден.",
    })

    const user = registered.db.users[0]
    const dbWithInvitation = {
      ...registered.db,
      workspaces: [
        {
          id: "workspace_invited",
          name: "Invited family",
          accessMode: "shared" as const,
          currencyCode: "RUB",
          ownerId: "user_owner",
          createdAt: "2026-06-01T00:00:00.000Z",
          members: [
            {
              id: "member_invited",
              userId: user.id,
              name: user.name,
              email: user.email,
              role: "member" as const,
              status: "invited" as const,
            },
          ],
        },
      ],
      session: null,
    }

    const invitedLogin = await loginAccount(dbWithInvitation, {
      email: " ANNA@example.COM ",
      password: "secret1",
    })

    expect(invitedLogin.ok).toBe(true)
    if (!invitedLogin.ok) {
      throw new Error(invitedLogin.error)
    }
    expect(invitedLogin.session).toMatchObject({
      userId: user.id,
      activeWorkspaceId: null,
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
      ssoProviders: [],
      ssoRoleMappings: [],
      ssoSessions: [],
      categories: [],
      transactions: [],
      budgets: [],
      liabilities: [],
      documents: [],
      session: null,
    })
  })

  it("normalizes SSO providers, sessions, role mappings, and member permissions", () => {
    const normalized = normalizeDatabase({
      users: [
        {
          id: "user_1",
          name: "Anna",
          email: "ANNA@example.com",
          passwordHash: "hash",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      workspaces: [
        {
          id: "workspace_1",
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
              role: "admin",
              status: "active",
              permissions: [
                "manageDocuments",
                "manageDocuments",
                "unknown:permission",
              ],
            },
          ],
        },
      ],
      ssoProviders: [
        {
          id: "provider_oidc",
          workspaceId: "workspace_1",
          type: "oidc",
          providerKind: "keycloak",
          name: " Workspace IdP ",
          status: "enabled",
          domainHint: "@Example.COM",
          issuer: "https://idp.example.com/",
          clientId: "bestbudget-spa",
          authorizationEndpoint: "https://idp.example.com/oauth2/authorize#drop",
          redirectUri: "https://app.example.com/auth/callback",
          scopes: "openid email profile email",
          responseMode: "form_post",
          pkce: false,
          tokenEndpoint: "https://idp.example.com/oauth2/token",
          roleClaim: "realm_access.roles",
          defaultRole: "member",
          allowOwnerRoleMapping: false,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "provider_invalid",
          type: "oidc",
          name: "Broken",
          clientId: "broken",
        },
      ],
      ssoRoleMappings: [
        {
          id: "mapping_1",
          providerId: "provider_oidc",
          workspaceId: "workspace_1",
          claim: "groups",
          value: "finance-admins",
          role: "admin",
          permissions: ["manageSso", "not-real"],
          priority: "20",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "mapping_invalid",
          providerId: "provider_missing",
          claim: "groups",
          value: "finance",
        },
      ],
      ssoSessions: [
        {
          id: "sso_session_1",
          providerId: "provider_oidc",
          userId: "user_1",
          subject: "idp-subject-1",
          email: "ANNA@example.com",
          displayName: " Anna ",
          groups: ["finance-admins", "finance-admins", ""],
          roles: ["Approver"],
          claims: {
            email_verified: true,
            tenant: "family",
            ignored: { nested: true },
          },
          issuedAt: "2026-06-01T00:00:00.000Z",
          expiresAt: "2099-06-01T00:00:00.000Z",
          lastSeenAt: "2026-06-02T00:00:00.000Z",
        },
      ],
      session: {
        userId: "user_1",
        activeWorkspaceId: "workspace_1",
        authMethod: "sso",
        ssoSessionId: "sso_session_1",
      },
    })

    expect(normalized.workspaces[0].members[0].permissions).toEqual([
      "manageDocuments",
    ])
    expect(normalized.ssoProviders).toHaveLength(1)
    expect(normalized.ssoProviders[0]).toMatchObject({
      id: "provider_oidc",
      workspaceId: "workspace_1",
      type: "oidc",
      providerKind: "keycloak",
      name: "Workspace IdP",
      domainHint: "example.com",
      authorizationEndpoint: "https://idp.example.com/oauth2/authorize",
      scopes: ["openid", "email", "profile"],
      responseMode: "form_post",
      pkce: true,
      roleClaim: "realm_access.roles",
      defaultRole: "member",
      allowOwnerRoleMapping: false,
    })
    expect(normalized.ssoRoleMappings).toEqual([
      expect.objectContaining({
        id: "mapping_1",
        workspaceId: "workspace_1",
        role: "admin",
        permissions: ["manageSso"],
        priority: 20,
      }),
    ])
    expect(normalized.ssoSessions).toEqual([
      expect.objectContaining({
        id: "sso_session_1",
        providerId: "provider_oidc",
        userId: "user_1",
        email: "anna@example.com",
        groups: ["finance-admins"],
        claims: {
          email_verified: true,
          tenant: "family",
        },
      }),
    ])
    expect(normalized.session).toMatchObject({
      userId: "user_1",
      activeWorkspaceId: "workspace_1",
      authMethod: "sso",
      ssoSessionId: "sso_session_1",
      expiresAt: "2099-06-01T00:00:00.000Z",
    })
  })

  it("completes SSO login by creating a local user, session, and mapped member role", () => {
    const db = normalizeDatabase({
      users: [
        {
          id: "user_owner",
          name: "Owner",
          email: "owner@example.com",
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
          ownerId: "user_owner",
          createdAt: "2026-06-01T00:00:00.000Z",
          members: [
            {
              id: "member_owner",
              userId: "user_owner",
              name: "Owner",
              email: "owner@example.com",
              role: "owner",
              status: "active",
            },
          ],
        },
      ],
      ssoProviders: [
        {
          id: "provider_keycloak",
          workspaceId: "workspace_family",
          type: "oidc",
          providerKind: "keycloak",
          name: "Keycloak",
          status: "enabled",
          issuer: "https://idp.example.com/realms/family",
          clientId: "bestbudget-web",
          scopes: "openid profile email",
          roleClaim: "realm_access.roles",
          defaultRole: "member",
          allowOwnerRoleMapping: false,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      ssoRoleMappings: [
        {
          id: "mapping_admin",
          providerId: "provider_keycloak",
          workspaceId: "workspace_family",
          claim: "groups",
          value: "finance-admins",
          role: "admin",
          priority: 10,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
    })

    const result = completeSsoLogin(db, {
      providerId: "provider_keycloak",
      subject: "kc-subject-1",
      email: "BORIS@example.com",
      name: "Boris",
      groups: ["finance-admins"],
      roles: [],
      claims: {
        sub: "kc-subject-1",
        email: "boris@example.com",
      },
      expiresAt: "2099-06-01T00:00:00.000Z",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.error)
    }

    const ssoUser = result.db.users.find(
      (user) => user.externalSubject === "kc-subject-1"
    )

    expect(ssoUser).toMatchObject({
      name: "Boris",
      email: "boris@example.com",
      authProvider: "sso",
      ssoProviderId: "provider_keycloak",
      passwordHash: "sso",
    })
    expect(result.session).toMatchObject({
      userId: ssoUser?.id,
      activeWorkspaceId: "workspace_family",
      authMethod: "sso",
      expiresAt: "2099-06-01T00:00:00.000Z",
    })
    expect(
      result.db.workspaces[0].members.find((member) => member.userId === ssoUser?.id)
    ).toMatchObject({
      name: "Boris",
      email: "boris@example.com",
      role: "admin",
      status: "active",
    })
  })

  it("normalizes persisted workspace roles and member statuses to supported RBAC values", () => {
    const normalized = normalizeDatabase({
      users: [
        {
          id: "user_1",
          name: "Anna",
          email: " ANNA@example.COM ",
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
              id: "member_owner",
              userId: "user_1",
              name: "Owner",
              email: "owner@example.com",
              role: "owner",
              status: "active",
            },
            {
              id: "member_admin",
              userId: "user_2",
              name: "Admin",
              email: "admin@example.com",
              role: "admin",
              status: "active",
            },
            {
              id: "member_member",
              userId: "user_3",
              name: "Member",
              email: "member@example.com",
              role: "member",
              status: "active",
            },
            {
              id: "member_observer",
              userId: "user_4",
              name: "Observer",
              email: "observer@example.com",
              role: "observer",
              status: "invited",
            },
            {
              id: "member_external_claim",
              userId: "",
              name: "",
              email: " EXTERNAL@example.COM ",
              role: "finance_admin",
              status: "pending",
            },
          ],
        },
      ],
    })

    expect(
      normalized.workspaces[0].members.map((member) => [
        member.id,
        member.role,
        member.status,
      ])
    ).toEqual([
      ["member_owner", "owner", "active"],
      ["member_admin", "admin", "active"],
      ["member_member", "member", "active"],
      ["member_observer", "observer", "invited"],
      ["member_external_claim", "member", "active"],
    ])
    expect(normalized.workspaces[0].members[4]).toMatchObject({
      userId: null,
      name: "external",
      email: "external@example.com",
    })
  })

  it("restores sessions only to active workspaces available to the member", () => {
    const normalized = normalizeDatabase({
      users: [
        {
          id: "user_1",
          name: "Anna",
          email: "anna@example.com",
          passwordHash: "hash",
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      workspaces: [
        {
          id: "workspace_active",
          name: "Active family",
          accessMode: "shared",
          currencyCode: "RUB",
          ownerId: "user_1",
          createdAt: "2026-06-01T00:00:00.000Z",
          members: [
            {
              id: "member_active",
              userId: "user_1",
              name: "Anna",
              email: "anna@example.com",
              role: "member",
              status: "active",
            },
          ],
        },
        {
          id: "workspace_invited",
          name: "Invited family",
          accessMode: "shared",
          currencyCode: "RUB",
          ownerId: "user_owner",
          createdAt: "2026-06-01T00:00:00.000Z",
          members: [
            {
              id: "member_invited",
              userId: "user_1",
              name: "Anna",
              email: "anna@example.com",
              role: "member",
              status: "invited",
            },
          ],
        },
      ],
      session: {
        userId: "user_1",
        activeWorkspaceId: "workspace_invited",
      },
    })

    expect(normalized.session).toMatchObject({
      userId: "user_1",
      activeWorkspaceId: "workspace_active",
      authMethod: "local",
    })
  })
})
