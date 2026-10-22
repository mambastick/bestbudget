# Contributing

## Local Development

```bash
pnpm install
cp .env.example .env   # see README → Разработка
pnpm db:dev            # embedded PostgreSQL (PGlite) on port 54329
pnpm db:migrate
pnpm dev
```

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

Schema changes go through `src/db/schema.ts` + `pnpm db:generate` (commit the generated migration).
Keep financial data handling changes small, reviewed, and covered by tests.
