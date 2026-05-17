# BestBudget

Web-first PWA for personal and family budgeting: transactions, budgets,
liabilities, PDF documents, salary allocation, reports, and a payment calendar
with a right-side day panel.

## Repository Layout

```text
bestbudget/
├── .github/
├── .vscode/
├── backend/                    # Node.js / TypeScript / Fastify
│   └── src/bestbudget/
│       ├── api/                # Routes and schemas
│       ├── application/        # Use cases
│       ├── domain/             # Business concepts
│       └── infrastructure/     # Database, MCP, adapters
├── deploy/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── k8s/
├── docs/
│   └── screenshots/
├── frontend/                   # React 19 + Vite + TypeScript + shadcn/ui
├── media/
├── .dockerignore
├── .env.example
├── .gitignore
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
└── SECURITY.md
```

## Development

```bash
pnpm install
cp .env.example .env
docker compose -f deploy/docker-compose.yml up -d postgres minio mailpit
pnpm dev
```

Native runner:

```bash
chmod +x deploy/run.sh
./deploy/run.sh --install --infra
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:8089`

## MCP

Project MCP servers are configured for VS Code/Codex in:

- `.mcp.json`
- `.vscode/mcp.json`

The local `bestbudget-project` server exposes project docs and MVP scope. The
`shadcn` server exposes shadcn/ui tooling for component work.
