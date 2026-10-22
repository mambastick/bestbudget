#!/bin/sh
# Run from the checkout containing compose.yaml and .env.
set -eu
cd "$(dirname -- "$0")/.."
exec docker compose run --rm --no-deps backup "$@"
