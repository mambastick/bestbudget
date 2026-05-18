# BestBudget

Web-first PWA for personal and shared budgeting: accounts, transactions,
category budgets, liabilities, documents, family members, invitations, and a
calendar with a day panel.

## Repository Layout

```text
bestbudget/
├── deploy/
│   ├── dev/                    # local Docker dev with mounted source code
│   └── prod/                   # production compose that pulls a registry image
├── docs/                       # architecture and implementation notes
├── public/                     # static PWA assets
├── src/                        # React 19 + Vite + TypeScript + shadcn/ui
│   ├── components/
│   ├── domain/
│   ├── hooks/
│   └── lib/
├── components.json             # shadcn/ui config
├── package.json
├── pnpm-lock.yaml
└── vite.config.ts
```

## Development

Application runtime is Docker-only. Do not start the app directly with
`pnpm dev`; the dev container owns the Vite process and mounts the repository
for hot reload.

```bash
cp .env.example .env
./deploy/dev/run.sh
```

App URL: `http://localhost:5173`

## Dev Container

The dev container builds locally and mounts the repository into `/app`, so code
changes on the host are reflected by Vite HMR inside the container.

Override the exposed port when needed:

```bash
APP_PORT=5174 ./deploy/dev/run.sh
```

Validation commands such as `pnpm typecheck`, `pnpm lint`, and `pnpm build` are
available for CI and local checks, but app startup should go through Docker.

## Docker Prod

Production compose pulls an already built image from a registry.

```bash
BESTBUDGET_IMAGE=ghcr.io/mambastick/bestbudget:latest ./deploy/prod/run.sh
```

Default production URL: `http://localhost:8080`

## MCP

Project MCP servers are configured for VS Code/Codex in:

- `.mcp.json`
- `.vscode/mcp.json`

The active MCP preset is the shadcn server. It is configured from the repository
root so Codex/VS Code work against the current `src/` structure.
