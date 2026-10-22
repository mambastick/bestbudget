#!/bin/sh
set -eu
. "$(dirname -- "$0")/common.sh"
case "${1:-now}" in
  schedule) exec sh "$SCRIPT_DIR/schedule.sh" ;;
  list) backup_names ;;
  verify) [ "$#" -eq 2 ] || fail 'Usage: verify <filename>'; verify "$2"; echo "Verified: $2" ;;
  restore)
    if [ "$#" -ne 3 ] || [ "$3" != '--yes' ]; then fail 'Stop the app first. Usage: restore <filename> --yes'; fi
    connection
    lock
    verify "$2"
    # Empty dbname enables direct restore while libpq reads connection defaults from env.
    # One transaction rolls back cleanup and restore together on any SQL error.
    pg_restore --dbname='' --no-password --clean --if-exists --no-owner --no-acl --single-transaction "$BACKUP_DIR/$2" 2>/dev/null || fail 'Restore failed; transaction rolled back. Check database availability, privileges and PostgreSQL versions.'
    echo "Restored: $2"
    ;;
  now)
    connection
    lock
    version=${BESTBUDGET_VERSION:-}
    case "$version" in *[!A-Za-z0-9._-]*) version= ;; esac
    if ! printf '%s\n' "$version" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]*$'; then version=; fi
    name="bestbudget-$(date -u +%Y%m%dT%H%M%SZ)${version:+-v$version}.dump"
    [ ! -e "$BACKUP_DIR/$name" ] || fail 'A backup with this timestamp already exists; retry in one second.'
    stage=$(mktemp -d "$BACKUP_DIR/.incomplete.XXXXXX")
    pg_dump --no-password --format=custom --compress=6 --no-owner --no-acl --file="$stage/$name" 2>/dev/null || fail 'pg_dump failed; no backup published. Check database availability, privileges and PostgreSQL versions.'
    pg_restore --list "$stage/$name" >/dev/null 2>&1 || fail 'Dump validation failed.'
    (cd "$stage" && sha256sum "$name" > "$name.sha256")
    mv -- "$stage/$name" "$BACKUP_DIR/$name"
    mv -- "$stage/$name.sha256" "$BACKUP_DIR/$name.sha256"
    sh "$SCRIPT_DIR/rotate.sh"
    echo "Created: $name"
    ;;
  *) fail 'Usage: [now|list|verify <filename>|restore <filename> --yes|schedule]' ;;
esac
