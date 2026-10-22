#!/bin/sh
# Keep writers and the scheduler stopped if restore fails, so recovery can be retried.
set -eu
cd "$(dirname -- "$0")/.."
if [ "$#" -ne 2 ] || [ "$2" != '--yes' ]; then
  echo 'Usage: scripts/restore.sh <backup-filename> --yes (replaces database contents)' >&2
  exit 1
fi
docker compose run --rm --no-deps backup verify "$1"
docker compose stop app backup
docker compose run --rm --no-deps backup restore "$1" --yes
docker compose up -d --wait app backup
