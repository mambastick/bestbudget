#!/bin/sh
set -e
# Apply pending database migrations (idempotent, serialized with an advisory lock), then start the server.
node dist-scripts/migrate.mjs
exec node server.js
