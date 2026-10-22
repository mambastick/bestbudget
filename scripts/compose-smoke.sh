#!/usr/bin/env bash
# Isolated CI deployment: persistence plus backup -> data loss -> restore -> verification.
set -euo pipefail
cd "$(dirname -- "$0")/.."
TASK_TMP=${TMPDIR:-/var/tmp/codex-golodn1y/bestbudget-backups}
mkdir -p "$TASK_TMP"
TEST_DIR=$(mktemp -d "$TASK_TMP/compose-smoke.XXXXXX")
COMPOSE_PROJECT_NAME="bestbudget-smoke-$(date +%s)-$$"
export COMPOSE_PROJECT_NAME
export COMPOSE_FILE="$PWD/compose.yaml" COMPOSE_PROFILES=''
export COMPOSE_ENV_FILES="$TEST_DIR/stack.env"
export BESTBUDGET_ENV_FILE="$COMPOSE_ENV_FILES"
# Explicit values override any inherited owner configuration, including cleanup mounts.
export APP_URL=http://127.0.0.1:3330 APP_PORT=3330 APP_BIND=127.0.0.1
export POSTGRES_USER=bestbudget POSTGRES_DB=bestbudget
export BACKUP_PATH="$TEST_DIR/backups" BACKUP_KEEP_LAST=7 BACKUP_KEEP_DAYS=30
export BACKUP_SCHEDULE='0 3 * * *' BESTBUDGET_VERSION=1.0.0-beta.1
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
SETUP_TOKEN=$(openssl rand -hex 16)
export BETTER_AUTH_SECRET POSTGRES_PASSWORD SETUP_TOKEN
# Keep the fixture .env out of argv, logs and the checkout; never touch owner ports/state.
umask 077
cat > "$COMPOSE_ENV_FILES" <<ENV
APP_URL=http://127.0.0.1:3330
APP_PORT=3330
APP_BIND=127.0.0.1
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
SETUP_TOKEN=$SETUP_TOKEN
BACKUP_PATH=$BACKUP_PATH
ENV
cleanup() {
  result=$?
  trap - EXIT
  set +e
  if [ "$result" -ne 0 ]; then docker compose logs --no-color --tail=100; fi
  docker compose down -v --remove-orphans
  # Container-created files may be owned by root; clean through the backup image.
  docker compose run --rm --no-deps --entrypoint sh backup -c 'find /backups -mindepth 1 -delete'
  docker compose down -v --remove-orphans
  rm -rf -- "$TEST_DIR"
  exit "$result"
}
trap cleanup EXIT
health() { curl -fsS http://127.0.0.1:3330/api/health; echo; }
admins() { docker compose exec -T app node dist-scripts/admin.mjs list-admins; }
sql() { docker compose exec -T db sh -c 'psql -X -v ON_ERROR_STOP=1 -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; }

docker compose up -d --build --wait --wait-timeout 180
docker compose run --rm --no-deps --entrypoint sh backup-s3 -c 'aws --version; for tool in grep sort sha256sum mktemp; do command -v "$tool" >/dev/null || exit 1; done'
health
curl -fsS -o /dev/null -w "setup page: %{http_code}\n" http://127.0.0.1:3330/setup
docker compose exec -T -e ADMIN_EMAIL=smoke@example.com -e ADMIN_PASSWORD=smoke-password-123 app node dist-scripts/admin.mjs create-admin
admins | grep -q smoke@example.com

docker compose restart app
docker compose up -d --wait --wait-timeout 120
admins | grep -q smoke@example.com
echo 'Data survived restart'
docker compose down
docker compose up -d --wait --wait-timeout 180
admins | grep -q smoke@example.com
health
echo 'Data survived re-creation'

sql <<'SQL'
INSERT INTO households (id, name) VALUES ('11111111-1111-4111-8111-111111111111', 'Backup smoke family');
INSERT INTO financial_accounts (id, household_id, name, kind, opening_balance)
VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Backup smoke account', 'cash', 990099);
INSERT INTO categories (id, household_id, kind, name)
VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'expense', 'Backup smoke category');
INSERT INTO transactions (id, household_id, type, status, amount, title, date, account_id, category_id)
VALUES ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'expense', 'posted', 123456789, 'Backup smoke transaction', '2026-10-23', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
SQL
./scripts/backup.sh now
backup=$(./scripts/backup.sh list | grep '^bestbudget-' | head -n 1)
[ -n "$backup" ]
./scripts/backup.sh verify "$backup"

# Rehearse total schema loss, including migration history. Keep the database and login role.
docker compose stop app backup
sql <<'SQL'
DROP SCHEMA public CASCADE;
DROP SCHEMA IF EXISTS drizzle CASCADE;
CREATE SCHEMA public;
SQL
[ "$(printf "SELECT to_regclass('public.users') IS NULL;\n" | sql)" = t ]
./scripts/restore.sh "$backup" --yes
admins | grep -q smoke@example.com
[ "$(printf "SELECT count(*) FROM transactions t JOIN households h ON h.id=t.household_id JOIN financial_accounts a ON (a.household_id,a.id)=(t.household_id,t.account_id) JOIN categories c ON (c.household_id,c.id)=(t.household_id,t.category_id) WHERE t.amount=123456789 AND t.date='2026-10-23' AND a.opening_balance=990099 AND h.name='Backup smoke family';\n" | sql)" = 1 ]
[ "$(printf "SELECT count(*) FROM auth_accounts a JOIN users u ON u.id=a.user_id WHERE u.email='smoke@example.com' AND a.provider_id='credential' AND a.password IS NOT NULL;\n" | sql)" = 1 ]
health
echo 'Backup/restore recovered administrator credentials and financial data'
