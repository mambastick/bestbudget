#!/bin/sh
# Starts the production server for Playwright. Set E2E_SKIP_BUILD=1 to reuse an existing build.
set -e
tsx scripts/migrate.ts
if [ "$E2E_SKIP_BUILD" != "1" ]; then
  next build
fi
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/
exec node .next/standalone/server.js
