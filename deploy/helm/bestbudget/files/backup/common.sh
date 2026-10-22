#!/bin/sh
set -eu
umask 077
export LC_ALL=C
BACKUP_DIR=${BACKUP_DIR:-/backups}
export SCRIPT_DIR
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

fail() { echo "Error: $*" >&2; exit 1; }

valid_name() {
  printf '%s\n' "$1" | grep -Eq '^bestbudget-[0-9]{8}T[0-9]{6}Z(-v[A-Za-z0-9][A-Za-z0-9._-]*)?\.dump$'
}

# The checksum rename is the commit marker. Ignore partial files and symlinks.
backup_names() {
  for path in "$BACKUP_DIR"/bestbudget-*.dump; do
    [ -f "$path" ] && [ ! -L "$path" ] || continue
    name=${path##*/}
    valid_name "$name" || continue
    [ -f "$path.sha256" ] && [ ! -L "$path.sha256" ] || continue
    printf '%s\n' "$name"
  done | sort -r
}

stage=
locked=false
cleanup() {
  [ -z "$stage" ] || rm -rf -- "$stage"
  if [ "$locked" = true ]; then rmdir "$BACKUP_DIR/.bestbudget-lock"; fi
}
lock() {
  mkdir -p "$BACKUP_DIR"
  mkdir "$BACKUP_DIR/.bestbudget-lock" 2>/dev/null || fail 'Backup directory is locked; see docs/backup.md before removing a stale lock.'
  locked=true
  trap cleanup EXIT
  trap 'exit 1' HUP INT TERM
}

connection() {
  [ -n "${PGDATABASE:-}${PGSERVICE:-}" ] || fail 'Set libpq connection variables (PGDATABASE or PGSERVICE).'
  export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"
}

verify() {
  valid_name "$1" || fail 'Expected a BestBudget dump filename, without a directory.'
  [ -f "$BACKUP_DIR/$1" ] && [ ! -L "$BACKUP_DIR/$1" ] || fail 'Dump is missing or is a symlink.'
  [ -f "$BACKUP_DIR/$1.sha256" ] && [ ! -L "$BACKUP_DIR/$1.sha256" ] || fail 'Checksum is missing or is a symlink.'
  expected=$(cat "$BACKUP_DIR/$1.sha256")
  actual=$(cd "$BACKUP_DIR" && sha256sum "$1")
  [ "$actual" = "$expected" ] || fail 'Checksum mismatch.'
  pg_restore --list "$BACKUP_DIR/$1" >/dev/null 2>&1 || fail 'Invalid PostgreSQL archive.'
}
