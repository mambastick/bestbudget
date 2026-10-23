# Contributing to BestBudget

Read the [README](README.md), [architecture](docs/architecture.md) and
[changelog](CHANGELOG.md) before making changes. Keep pull requests focused and
describe the problem, resulting behavior, checks and remaining limitations.
Use English for code, identifiers and code comments.

## Protect financial data

Never put real bank statements, financial data, credentials or database dumps in
issues, pull requests, screenshots, fixtures or commits. Use synthetic data only;
redacting names from a real statement is not enough. Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md).

## Local development

Use Node.js 22+ and pnpm 10.27.0. Docker is optional for source development.

```bash
npx -y pnpm@10.27.0 install --frozen-lockfile
cp .env.example .env
```

Set `APP_URL=http://localhost:3300`,
`DATABASE_URL=postgres://postgres@127.0.0.1:54340/postgres`,
`BETTER_AUTH_SECRET` and `SETUP_TOKEN` in your local `.env`. Generate separate
secrets, for example with `openssl rand -hex 32`; never commit `.env`.

Start the persistent development database in one terminal:

```bash
PGLITE_PORT=54340 npx -y pnpm@10.27.0 db:dev
```

In another terminal, apply migrations and start Next.js. The migration script
reads `DATABASE_URL` from the environment; Next.js loads `.env` itself.

```bash
DATABASE_URL=postgres://postgres@127.0.0.1:54340/postgres npx -y pnpm@10.27.0 db:migrate
PORT=3300 npx -y pnpm@10.27.0 dev
```

Open `http://localhost:3300/setup` and use your `SETUP_TOKEN` to create the first
administrator. Create a household and use synthetic examples for development.
`db:seed-demo <email>` can populate an empty RUB demo household with its single
default account; never run it against a personal or production database.

Keep temporary files and build artifacts in a location appropriate for your
machine. Set `TMPDIR` to a disk-backed directory if the system temporary directory
is RAM-backed. `work/` is ignored by Git and can hold local test artifacts.

## Code and schema conventions

- Money uses `BIGINT` minor units (kopecks for RUB), never floating-point storage
  or arithmetic. Use `src/lib/money.ts` and the existing integer conversion helpers.
- Calendar dates use `YYYY-MM-DD` / SQL `date`. Use `src/lib/dates.ts` for today in
  the household time zone.
- Scope every financial query to its household. Financial references require
  composite `(household_id, id)` foreign keys; enforce permissions through
  `src/domain/permissions.ts` and the server context helpers.
- Put business logic in `src/server/services/`. Validate with Zod; actions in
  `src/app/actions/` return `ActionResult` through `runAction`. Redirect on the
  client, audit important changes and preserve optimistic `version` checks.
- Never log secrets. Encrypt stored tokens and keys using `src/lib/crypto.ts`.
  Review any changes to the CSP in `next.config.ts` deliberately.
- Reuse components in `src/components/ui` and `src/components/app`. Start grids
  with `grid-cols-1`, check 375 px without horizontal scrolling and use
  `--chart-1` through `--chart-5` for charts. Follow the
  [ru/en localization guide](docs/i18n.md) for user-facing text.
- Match nearby code and avoid unnecessary heavy dependencies. Preserve vendor
  attribution and follow [third-party licenses](THIRD_PARTY_NOTICES.md).

After changing `src/db/schema.ts`, generate a new migration:

```bash
npx -y pnpm@10.27.0 drizzle-kit generate --name meaningful_change
```

Commit the generated SQL and metadata. Do not edit existing migrations. Use safe
defaults/backfills for existing beta data and test upgrades; avoid destructive
schema changes without an explicit migration plan.

## Checks before a pull request

```bash
npx -y pnpm@10.27.0 typecheck
npx -y pnpm@10.27.0 lint
npx -y pnpm@10.27.0 test
npx -y pnpm@10.27.0 build
```

Vitest starts its own isolated PGlite and applies real migrations. For browser
changes, install Chromium once and run Playwright on the production build:

```bash
npx -y pnpm@10.27.0 exec playwright install chromium
npx -y pnpm@10.27.0 test:e2e
```

Ports **3200/54330** must be free for E2E; do not reuse or stop someone else's
application/database. For Helm changes run `./scripts/check-helm.sh`. Docker
build, persistence and backup/restore checks use `./scripts/compose-smoke.sh`
and require a working Docker daemon; CI runs them on GitHub-hosted runners.
Validate shell changes with the matching shell (`sh -n` / `bash -n`) and
ShellCheck. Validate workflow changes with actionlint when available.

Use conventional commit prefixes such as `feat:`, `fix:`, `docs:` or `test:`.
In the PR, list checks actually run, explain skipped checks, mention migrations
and ru/en changes, and include desktop/mobile screenshots for UI changes using
synthetic data only. Maintainers review and merge pull requests.
