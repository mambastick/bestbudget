#!/usr/bin/env bash
# Build once, then deploy from an isolated directory containing only compose.yaml and .env.
set -euo pipefail
ROOT=$(cd "$(dirname -- "$0")/.." && pwd)
TASK_TMP=${TMPDIR:-/tmp}
mkdir -p "$TASK_TMP"
TEST_DIR=$(mktemp -d "$TASK_TMP/compose-smoke.XXXXXX")
export COMPOSE_PROJECT_NAME="bestbudget-smoke-$$"
export COMPOSE_FILE="$TEST_DIR/compose.yaml"
export COMPOSE_ENV_FILES="$TEST_DIR/.env" COMPOSE_PROFILES=''
export APP_URL=http://127.0.0.1:3330 APP_PORT=3330 APP_BIND=127.0.0.1
export POSTGRES_USER=bestbudget POSTGRES_DB=bestbudget
export BACKUP_PATH=./backups BACKUP_TIME=03:00 TZ=Europe/Moscow
export BACKUP_KEEP_LAST=7 BACKUP_KEEP_DAYS=30
unset BACKUP_ENABLED
export BESTBUDGET_VERSION=backup-smoke
LOCAL_UID=$(id -u)
LOCAL_GID=$(id -g)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
export LOCAL_UID LOCAL_GID BETTER_AUTH_SECRET POSTGRES_PASSWORD
# Do not inherit optional uploader credentials from the host.
export BACKUP_S3_BUCKET='' AWS_ACCESS_KEY_ID='' AWS_SECRET_ACCESS_KEY=''
umask 077
cp "$ROOT/compose.yaml" "$TEST_DIR/compose.yaml"
mkdir "$TEST_DIR/backups"
cat > "$TEST_DIR/.env" <<ENV
APP_URL=$APP_URL
BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
LOCAL_UID=$LOCAL_UID
LOCAL_GID=$LOCAL_GID
ENV
cleanup() {
  result=$?
  trap - EXIT
  set +e
  if [ "$result" -ne 0 ]; then docker compose logs --no-color --tail=100; fi
  docker compose down -v --remove-orphans
  rm -rf -- "$TEST_DIR"
  exit "$result"
}
trap cleanup EXIT
version=$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")
image=ghcr.io/mambastick/bestbudget:backup-smoke
docker build --build-arg VERSION="$version" -t "$image" "$ROOT"
docker build --target app-runtime --build-arg VERSION="$version" -t bestbudget-size-baseline "$ROOT"
new_size=$(docker image inspect "$image" --format '{{.Size}}')
base_size=$(docker image inspect bestbudget-size-baseline --format '{{.Size}}')
size_report="Image growth: $((new_size - base_size)) bytes ($base_size -> $new_size), PostgreSQL clients + tzdata + bundled backup CLI"
echo "$size_report"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$size_report" >> "$GITHUB_STEP_SUMMARY"; fi
cd "$TEST_DIR"
# The deployed stack cannot read any checkout paths: no Dockerfile, scripts or chart files here.
[ "$(find . -maxdepth 1 -type f | wc -l)" -eq 2 ]
health() { curl -fsS http://127.0.0.1:3330/api/health; echo; }
admins() { docker compose exec -T app node dist-scripts/admin.mjs list-admins; }
sql() { docker compose exec -T db sh -c 'psql -X -v ON_ERROR_STOP=1 -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; }
backup() { docker compose run --rm -T --no-deps backup "$@"; }

docker compose up -d --wait --wait-timeout 180
[ "$(docker compose exec -T backup id -u)" = "$LOCAL_UID" ]
health
docker compose exec -T -e ADMIN_EMAIL=smoke@example.com -e ADMIN_PASSWORD=smoke-password-123 app node dist-scripts/admin.mjs create-admin
admins | grep -q smoke@example.com
docker compose restart app
docker compose up -d --wait --wait-timeout 120
admins | grep -q smoke@example.com
docker compose down
docker compose up -d --wait --wait-timeout 180
admins | grep -q smoke@example.com
sql <<'SQL'
INSERT INTO households (id, name) VALUES ('11111111-1111-4111-8111-111111111111', 'Backup smoke family');
INSERT INTO financial_accounts (id, household_id, name, kind, opening_balance)
VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Backup smoke account', 'cash', 990099);
INSERT INTO categories (id, household_id, kind, name)
VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'expense', 'Backup smoke category');
INSERT INTO transactions (id, household_id, type, status, amount, title, date, account_id, category_id)
VALUES ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111', 'expense', 'posted', 123456789, 'Backup smoke transaction', '2026-10-23', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
SQL
backup now
dump=$(backup list --json | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["name"])')
[ -r "backups/$dump" ]
[ "$(stat -c %u "backups/$dump")" = "$LOCAL_UID" ]
backup verify "backups/$dump"
backup status --health
failed_s3() {
  docker compose run --rm -T --no-deps -e BACKUP_S3_BUCKET=fixture -e BACKUP_S3_ENDPOINT=http://127.0.0.1:9 -e AWS_ACCESS_KEY_ID=fixture -e AWS_SECRET_ACCESS_KEY=fixture backup "$@"
}
if failed_s3 now > s3-failure.log 2>&1; then echo 'FAIL: inaccessible S3 reported success'; exit 1; fi
failed_s3 status --json | python3 -c 'import json,sys; s=json.load(sys.stdin); assert s["s3"]["status"]=="error" and s["lastSuccess"]'
backup now
# An app with an open connection must block restore before creating a safety dump or changing data.
health
[ "$(printf "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend';\n" | sql)" -ge 1 ]
sql <<'SQL'
UPDATE users SET name='Preserved on refused restore' WHERE email='smoke@example.com';
SQL
files_before_refusal=$(find backups -type f -printf '%f %s %T@\n' | sort)
if backup restore "backups/$dump" --yes > refused.log 2>&1; then
  echo 'FAIL: restore allowed while app was running'; exit 1
else
  # Assert the CLI failure code without depending on localized error text.
  [ "$?" -eq 1 ] || { cat refused.log; exit 1; }
fi
[ "$(find backups -type f -printf '%f %s %T@\n' | sort)" = "$files_before_refusal" ]
[ "$(printf "SELECT name FROM users WHERE email='smoke@example.com';\n" | sql)" = 'Preserved on refused restore' ]

docker compose stop app
# Force a dependency failure and verify transactional rollback plus the safety dump.
sql <<'SQL'
CREATE TABLE restore_guard (user_id uuid REFERENCES users(id));
INSERT INTO restore_guard SELECT id FROM users;
UPDATE users SET name='Preserved on restore failure';
SQL
if backup restore "backups/$dump" --yes > rollback.log 2>&1; then echo 'FAIL: restore ignored dependency'; exit 1; fi
[ "$(printf "SELECT name FROM users WHERE email='smoke@example.com';\n" | sql)" = 'Preserved on restore failure' ]
[ "$(find backups -name '*-before-restore-*.dump' | wc -l)" -ge 1 ]
sql <<'SQL'
DROP SCHEMA public CASCADE;
DROP SCHEMA IF EXISTS drizzle CASCADE;
CREATE SCHEMA public;
SQL
[ "$(printf "SELECT to_regclass('public.users') IS NULL;\n" | sql)" = t ]
# The public, checkout-free restore command, including automatic safety backup.
backup restore "backups/$dump" --yes
docker compose start app
docker compose up -d --wait --wait-timeout 180
admins | grep -q smoke@example.com
[ "$(printf "SELECT count(*) FROM transactions t JOIN households h ON h.id=t.household_id JOIN financial_accounts a ON (a.household_id,a.id)=(t.household_id,t.account_id) JOIN categories c ON (c.household_id,c.id)=(t.household_id,t.category_id) WHERE t.amount=123456789 AND t.date='2026-10-23' AND a.opening_balance=990099 AND h.name='Backup smoke family';\n" | sql)" = 1 ]
[ "$(printf "SELECT count(*) FROM auth_accounts a JOIN users u ON u.id=a.user_id WHERE u.email='smoke@example.com' AND a.provider_id='credential' AND a.password IS NOT NULL;\n" | sql)" = 1 ]
health
echo 'Checkout-free backup/restore recovered administrator credentials and financial data'

# Disabling automatic dumps must keep --wait healthy and manual commands usable.
export BACKUP_ENABLED=false
printf '%s\n' '{"firstDue":"2000-01-01T00:00:00Z","nextRun":"2000-01-01T00:00:00Z"}' > backups/.schedule.json
files_before=$(find backups -type f -printf '%f %s %T@\n' | sort)
docker compose up -d --wait --wait-timeout 180
# --wait and the JSON health contract establish scheduler state without matching log wording.
[ "$(find backups -type f -printf '%f %s %T@\n' | sort)" = "$files_before" ]
backup status --json --health | python3 -c 'import json,sys; s=json.load(sys.stdin); assert s["enabled"] is False and s["healthy"] is True and s["nextRun"] is None'
backup list --json | python3 -c 'import json,sys; assert json.load(sys.stdin)'
backup now
docker compose stop app
backup restore "backups/$dump" --yes
docker compose start app
docker compose up -d --wait --wait-timeout 180
admins | grep -q smoke@example.com
[ "$(printf "SELECT count(*) FROM transactions WHERE id='44444444-4444-4444-8444-444444444444' AND amount=123456789;\n" | sql)" = 1 ]
health
echo 'Disabled scheduler stays healthy; manual backup/list/restore recovered administrator and financial data'
