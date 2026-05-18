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
- After login, the user creates one or more workspaces.
- A workspace can be `individual` or `shared`.
- The active workspace is selected from the sidebar brand dropdown.
- Shared workspaces contain member records and invited users.

## MVP Boundary

The current frontend MVP focuses on functional flows: registration/login,
workspace creation and switching, currency selection, category templates,
transactions, budgets, calendar events, liabilities, documents, family members,
and invitations. Production-grade auth, encryption, role enforcement, document
storage, and integrations are not implemented yet.
