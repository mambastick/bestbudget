# BestBudget Architecture

BestBudget follows a Cleanarr-style repository layout with separate `backend/`,
`frontend/`, `deploy/`, `docs/screenshots/`, and `media/` directories.

## Runtime Shape

- `frontend/`: React 19, Vite, TypeScript, Tailwind CSS v4, shadcn/ui.
- `backend/`: Node.js, TypeScript, Fastify, Drizzle ORM, PostgreSQL.
- `deploy/`: Docker Compose for local infrastructure and Kubernetes manifests.
- `.vscode/mcp.json` and `.mcp.json`: MCP server definitions for VS Code/Codex workflows.

## Backend Layers

- `api/`: Fastify app, HTTP routes, request/response schemas.
- `application/`: use cases and orchestration.
- `domain/`: business concepts with no framework dependencies.
- `infrastructure/`: database, external adapters, local MCP project server.

## MVP Boundary

The first implementation keeps integrations as explicit seams: OIDC/SAML routes,
OCR, object storage, calendar sync, notifications, and open banking are prepared
architecturally but not enabled without provider configuration.
