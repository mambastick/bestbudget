#!/bin/sh
# Optional real PostgreSQL test. Put initdb/pg_ctl/psql/pg_dump/pg_restore on PATH.
set -eu
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
SCRIPTS="$ROOT/deploy/helm/bestbudget/files/backup"
TASK_TMP=${TMPDIR:-/var/tmp/codex-golodn1y/bestbudget-backups}
mkdir -p "$TASK_TMP"
TEST_DIR=$(mktemp -d "$TASK_TMP/postgres-test.XXXXXX")
umask 077
started=false
cleanup() {
  result=$?
  trap - EXIT
  if [ "$started" = true ]; then pg_ctl -D "$TEST_DIR/data" -m immediate -w stop >/dev/null; fi
  if [ "$result" -eq 0 ]; then rm -rf -- "$TEST_DIR"; else echo "Test artifacts: $TEST_DIR" >&2; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
# Fixture-only password also exercises colon, backslash and a space in the URI adapter.
export PGPASSWORD='fixture:p\ss word'
printf '%s\n' "$PGPASSWORD" > "$TEST_DIR/password"
initdb -D "$TEST_DIR/data" -U postgres --auth=scram-sha-256 --pwfile="$TEST_DIR/password" > "$TEST_DIR/initdb.log"
mkdir "$TEST_DIR/socket"
# A private Unix socket avoids every existing TCP listener on the host.
pg_ctl -D "$TEST_DIR/data" -l "$TEST_DIR/postgres.log" -o "-k $TEST_DIR/socket -h '' -p 54341" -w start >/dev/null
started=true
export PGHOST="$TEST_DIR/socket" PGPORT=54341 PGDATABASE=postgres PGUSER=postgres
for migration in "$ROOT"/drizzle/*.sql; do psql -X -v ON_ERROR_STOP=1 -f "$migration" > "$TEST_DIR/migration.log"; done
psql -X -v ON_ERROR_STOP=1 > "$TEST_DIR/fixture.log" <<'SQL'
CREATE SCHEMA drizzle;
CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('backup-test', 1);
INSERT INTO users (id, name, email, role) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Backup admin', 'backup@example.com', 'admin');
INSERT INTO auth_accounts (account_id, provider_id, user_id, password) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'credential', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fixture-hash');
INSERT INTO households (id, name) VALUES ('11111111-1111-4111-8111-111111111111', 'Backup family');
INSERT INTO financial_accounts (id, household_id, name, kind, opening_balance) VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Cash', 'cash', 990099);
INSERT INTO categories (id, household_id, kind, name) VALUES ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'expense', 'Food');
INSERT INTO transactions (household_id, type, status, amount, title, date, account_id, category_id) VALUES ('11111111-1111-4111-8111-111111111111', 'expense', 'posted', 123456789, 'Backup test', '2026-10-23', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');
SQL
# Authenticate through the same private service/pgpass files as the Helm Job.
export CONNECTION_DIR="$TEST_DIR/connection"
DATABASE_URL=$(node -e 'console.log("postgres://postgres:" + encodeURIComponent(process.env.PGPASSWORD) + "@localhost:54341/postgres?host=" + encodeURIComponent(process.env.PGHOST))')
export DATABASE_URL
node "$SCRIPTS/connection.mjs"
unset DATABASE_URL PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
export PGSERVICE=bestbudget PGSERVICEFILE="$CONNECTION_DIR/pg_service.conf"
export BACKUP_DIR="$TEST_DIR/backups" BESTBUDGET_VERSION=1.0.0-beta.1
sh "$SCRIPTS/backup.sh" now
backup=$(sh "$SCRIPTS/backup.sh" list)
sh "$SCRIPTS/backup.sh" verify "$backup"
psql -X -v ON_ERROR_STOP=1 > "$TEST_DIR/drop.log" 2>&1 <<'SQL'
DROP SCHEMA public CASCADE;
DROP SCHEMA drizzle CASCADE;
CREATE SCHEMA public;
SQL
[ "$(psql -X -tAc "SELECT to_regclass('public.users') IS NULL")" = t ]
sh "$SCRIPTS/backup.sh" restore "$backup" --yes
[ "$(psql -X -tAc "SELECT count(*) FROM users u JOIN auth_accounts a ON a.user_id=u.id WHERE u.email='backup@example.com' AND u.role='admin' AND a.password='fixture-hash'")" = 1 ]
[ "$(psql -X -tAc "SELECT count(*) FROM transactions t JOIN financial_accounts a ON (a.household_id,a.id)=(t.household_id,t.account_id) WHERE t.amount=123456789 AND t.date='2026-10-23' AND a.opening_balance=990099")" = 1 ]
[ "$(psql -X -tAc 'SELECT count(*) FROM drizzle.__drizzle_migrations')" = 1 ]
# Force a real DROP dependency failure and prove cleanup is rolled back too.
psql -X -v ON_ERROR_STOP=1 > "$TEST_DIR/guard.log" <<'SQL'
CREATE TABLE restore_guard (user_id uuid REFERENCES users(id));
INSERT INTO restore_guard SELECT id FROM users;
UPDATE users SET name='Preserved on failure';
SQL
if sh "$SCRIPTS/backup.sh" restore "$backup" --yes > "$TEST_DIR/rollback.log" 2>&1; then echo 'FAIL: restore should have failed on dependency'; exit 1; fi
[ "$(psql -X -tAc 'SELECT name FROM users')" = 'Preserved on failure' ]
psql -X -v ON_ERROR_STOP=1 -c 'DROP TABLE restore_guard' > /dev/null
sh "$SCRIPTS/backup.sh" restore "$backup" --yes
[ "$(psql -X -tAc 'SELECT name FROM users')" = 'Backup admin' ]
echo 'Real PostgreSQL backup/restore, SCRAM credentials and rollback tests passed.'
