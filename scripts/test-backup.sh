#!/bin/sh
# Deterministic filesystem tests, without Docker, PostgreSQL or extra test dependencies.
set -eu
TASK_TMP=${TMPDIR:-/var/tmp/codex-golodn1y/bestbudget-backups}
mkdir -p "$TASK_TMP"
TEST_DIR=$(mktemp -d "$TASK_TMP/backup-tests.XXXXXX")
trap 'rm -rf -- "$TEST_DIR"' EXIT
trap 'exit 1' HUP INT TERM
ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
SCRIPTS="$ROOT/deploy/helm/bestbudget/files/backup"
export BACKUP_DIR="$TEST_DIR/backups"
mkdir -p "$BACKUP_DIR" "$TEST_DIR/bin"
check() { if ! "$@"; then echo "FAIL: $*" >&2; exit 1; fi; }
fixture() {
  printf 'fixture\n' > "$BACKUP_DIR/$1"
  (cd "$BACKUP_DIR" && sha256sum "$1" > "$1.sha256")
}
for day in 01 02 03 04 05; do fixture "bestbudget-202601${day}T030000Z.dump"; done
fixture bestbudget-20260106T030000Z-v1.0.0-beta.1.dump
# A recent copy is retained even when it falls outside the count limit.
fixture bestbudget-20261020T030000Z.dump
fixture bestbudget-20261021T030000Z.dump
fixture bestbudget-20261022T030000Z.dump
fixture bestbudget-20261023T030000Z.dump
printf 'owner file\n' > "$BACKUP_DIR/notes.dump"
printf 'partial\n' > "$BACKUP_DIR/bestbudget-20200101T000000Z.dump"
printf 'partial\n' > "$BACKUP_DIR/.incomplete.dump"
fixture bestbudget-20200101T000001Z.dump.extra
fixture bestbudget-20200101T000002Z-vbad+version.dump
foreign=$(printf 'bestbudget-20200101T000004Z.dump\nforeign.dump')
fixture "$foreign"
ln -s notes.dump "$BACKUP_DIR/bestbudget-20200101T000003Z.dump"
printf 'unrelated\n' > "$BACKUP_DIR/bestbudget-20200101T000003Z.dump.sha256"
export BACKUP_KEEP_LAST=2 BACKUP_KEEP_DAYS=30 BACKUP_CUTOFF=20261001T000000Z
sh "$SCRIPTS/rotate.sh"
check test ! -e "$BACKUP_DIR/bestbudget-20260106T030000Z-v1.0.0-beta.1.dump"
check test ! -e "$BACKUP_DIR/bestbudget-20260101T030000Z.dump.sha256"
check test -f "$BACKUP_DIR/bestbudget-20261020T030000Z.dump"
check test -f "$BACKUP_DIR/notes.dump"
check test -f "$BACKUP_DIR/bestbudget-20200101T000000Z.dump"
check test -L "$BACKUP_DIR/bestbudget-20200101T000003Z.dump"
check test -f "$BACKUP_DIR/bestbudget-20200101T000001Z.dump.extra"
check test -f "$BACKUP_DIR/bestbudget-20200101T000002Z-vbad+version.dump"
check test -f "$BACKUP_DIR/$foreign"
# Count retention still protects the newest copies when every copy is old.
export BACKUP_CUTOFF=20261101T000000Z
sh "$SCRIPTS/rotate.sh"
check test -f "$BACKUP_DIR/bestbudget-20261022T030000Z.dump"
check test -f "$BACKUP_DIR/bestbudget-20261023T030000Z.dump"
check test ! -e "$BACKUP_DIR/bestbudget-20261021T030000Z.dump"
if BACKUP_KEEP_LAST=0 sh "$SCRIPTS/rotate.sh" >/dev/null 2>&1; then echo 'FAIL: zero retention accepted'; exit 1; fi
# Exercise the age calculation, using only POSIX shell and Alpine-compatible date syntax.
unset BACKUP_CUTOFF
sh "$SCRIPTS/rotate.sh"

for schedule in '60 3 * * *' '0 24 * * *' '*/2-3 3 * * *' '0 3 * * 7' '0 3 * * *;false'; do
  if BACKUP_SCHEDULE="$schedule" sh "$SCRIPTS/schedule.sh" > "$TEST_DIR/cron.log" 2>&1; then echo 'FAIL: invalid cron accepted'; exit 1; fi
done

# Simulate pg_dump failing midway: neither dump nor checksum may be published.
cat > "$TEST_DIR/bin/pg_dump" <<'MOCK'
#!/bin/sh
for arg do case "$arg" in --file=*) printf partial > "${arg#--file=}" ;; esac; done
exit 1
MOCK
cat > "$TEST_DIR/bin/pg_restore" <<'MOCK'
#!/bin/sh
exit 0
MOCK
chmod +x "$TEST_DIR/bin/pg_dump" "$TEST_DIR/bin/pg_restore"
export PATH="$TEST_DIR/bin:$PATH" PGDATABASE=test BESTBUDGET_VERSION=test
before=$(sh "$SCRIPTS/backup.sh" list)
if sh "$SCRIPTS/backup.sh" now > "$TEST_DIR/failure.log" 2>&1; then echo 'FAIL: pg_dump failure accepted'; exit 1; fi
check test "$before" = "$(sh "$SCRIPTS/backup.sh" list)"
check test ! -d "$BACKUP_DIR/.bestbudget-lock"
check test -z "$(find "$BACKUP_DIR" -type d -name '.incomplete.*' -print)"
# A bad checksum and missing confirmation must stop before pg_restore is called.
printf corrupt >> "$BACKUP_DIR/bestbudget-20261023T030000Z.dump"
if sh "$SCRIPTS/backup.sh" restore bestbudget-20261023T030000Z.dump --yes >/dev/null 2>&1; then echo 'FAIL: corrupt backup accepted'; exit 1; fi
if sh "$SCRIPTS/backup.sh" restore bestbudget-20261022T030000Z.dump >/dev/null 2>&1; then echo 'FAIL: missing confirmation accepted'; exit 1; fi

# AWS CLI is a separate image; test ordering, retry and destination changes with a mock.
cat > "$TEST_DIR/bin/aws" <<'MOCK'
#!/bin/sh
[ "${UPLOAD_FAIL:-false}" = false ] || exit 1
printf '%s\n' "$4" >> "$UPLOAD_LOG"
MOCK
chmod +x "$TEST_DIR/bin/aws"
fixture bestbudget-20261023T030000Z.dump
export UPLOAD_LOG="$TEST_DIR/upload.log" BACKUP_S3_BUCKET=test-bucket
sh "$SCRIPTS/upload.sh"
check test "$(wc -l < "$UPLOAD_LOG")" -eq 4
check test "$(sed -n '1p' "$UPLOAD_LOG")" = 's3://test-bucket/bestbudget-20261023T030000Z.dump'
check test "$(sed -n '2p' "$UPLOAD_LOG")" = 's3://test-bucket/bestbudget-20261023T030000Z.dump.sha256'
sh "$SCRIPTS/upload.sh"
check test "$(wc -l < "$UPLOAD_LOG")" -eq 4
BACKUP_S3_BUCKET=another-bucket sh "$SCRIPTS/upload.sh"
check test "$(wc -l < "$UPLOAD_LOG")" -eq 8
rm "$BACKUP_DIR/bestbudget-20261023T030000Z.dump.uploaded"
if UPLOAD_FAIL=true sh "$SCRIPTS/upload.sh" >/dev/null 2>&1; then echo 'FAIL: failed upload accepted'; exit 1; fi
check test ! -f "$BACKUP_DIR/bestbudget-20261023T030000Z.dump.uploaded"
check test ! -d "$BACKUP_DIR/.bestbudget-lock"

# The connection adapter must percent-decode credentials, preserve SSL, and escape pgpass.
export CONNECTION_DIR="$TEST_DIR/connection"
DATABASE_URL='postgres://budget:p%3Aa%5Css%20word@[::1]:5433/family?sslmode=require&application_name=backup' node "$SCRIPTS/connection.mjs"
check grep -Fxq 'host=::1' "$CONNECTION_DIR/pg_service.conf"
check grep -Fxq 'sslmode=require' "$CONNECTION_DIR/pg_service.conf"
check grep -Fxq 'dbname=family' "$CONNECTION_DIR/pg_service.conf"
check grep -Fxq '*:*:*:*:p\:a\\ss word' "$CONNECTION_DIR/pgpass"
check test "$(stat -c %a "$CONNECTION_DIR/pgpass")" = 600
if DATABASE_URL='postgres://user:secret@localhost/db?host=bad%0Apassword%3Dsecret' node "$SCRIPTS/connection.mjs" > "$TEST_DIR/connection.log" 2>&1; then echo 'FAIL: multiline connection value accepted'; exit 1; fi
if grep -q secret "$TEST_DIR/connection.log"; then echo 'FAIL: credentials leaked'; exit 1; fi
printf 'Backup filesystem and connection tests passed.\n'
