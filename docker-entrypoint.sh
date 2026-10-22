#!/bin/sh
set -e
if [ "${1:-}" = "backup" ]; then
  shift
  exec node dist-scripts/backup.mjs "$@"
fi
# Apply pending database migrations (idempotent, serialized with an advisory lock), then start the server.
node dist-scripts/migrate.mjs
exec node server.js
