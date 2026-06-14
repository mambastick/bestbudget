# BestBudget Architecture

BestBudget currently uses a single Vite/React codebase at the repository root.
The source tree is intentionally consolidated under `src/` instead of separate
`frontend/` and `backend/` packages.

## Runtime Shape

- `src/`: React 19, Vite, TypeScript, Tailwind CSS v4, shadcn/ui, and local
  domain state for the current MVP.
- `src/domain/`: typed entities, selectors, local persistence, presets for
  currencies and categories.
- `src/components/app/`: application shell, screens, dialogs, and form
  composition built from shadcn/ui primitives.
- `src/components/reactbits/`: small ReactBits-style animation wrappers for
  non-critical visual emphasis.
- `deploy/dev/`: Docker Compose that builds a dev image and mounts the working
  tree for local hot reload.
- `deploy/prod/`: Docker Compose that pulls a registry image and serves the
  production build through nginx.
- `.vscode/mcp.json` and `.mcp.json`: MCP definitions for VS Code/Codex.

## Persistence Boundary

The current implementation stores users, sessions, workspaces, categories,
transactions, budgets, liabilities, documents, and invitations in browser
`localStorage` under one versioned key. This gives each registered local account
its own password-protected profile in the browser while keeping the MVP runnable
without external services.

A server-side BFF/API, PostgreSQL, object storage, SSO, OCR, banking imports,
and audit logs remain future production work. They should be added behind the
existing domain boundaries rather than by moving UI code back into a split
monorepo.

## Access Model

- A user registers with name, email, and password.
- A workspace owner/admin can configure an OIDC SSO provider for the active
  workspace. The current SPA supports Keycloak, authentik, and generic OIDC
  providers through Authorization Code + PKCE.
- After login, the user creates one or more workspaces.
- A workspace can be `individual` or `shared`.
- The active workspace is selected from the sidebar brand dropdown.
- Shared workspaces contain member records and invited users.
- Workspace roles are enforced by a local RBAC matrix in the UI and all
  state-changing handlers: `owner` and `admin` can manage workspace data,
  members, and SSO; `member` can manage transactions, liabilities, and
  documents; `observer` is read-only.

## SSO Boundary

SSO in the frontend MVP is a browser-only OIDC integration. The app performs
PKCE redirect/login, exchanges the authorization code with the IdP, reads
identity claims, creates a local SSO user/session, and maps IdP groups/roles to
workspace roles. Access tokens and ID tokens are not persisted in
`localStorage`.

Because the data store is still browser `localStorage`, RBAC is an application
guardrail and UX contract, not a production security boundary. A backend/BFF is
still required for server-enforced authorization, SAML ACS/signature validation,
token refresh/revocation, audit logs, document access control, and tenant
isolation.

## MVP Boundary

The current frontend MVP focuses on functional flows: registration/login,
workspace creation and switching, currency selection, category templates,
transactions, budgets, calendar events, liabilities, documents, family members,
invitations, OIDC SSO bootstrap, and local RBAC enforcement. Production-grade
auth, encryption, document storage, audit trails, and server-side authorization
remain backend work.
