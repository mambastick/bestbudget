#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DEPS=0
START_INFRA=0

usage() {
  cat <<'USAGE'
Usage: deploy/run.sh [options]

Run BestBudget natively on the host machine.

Options:
  --install      Run pnpm install before starting.
  --infra        Start local Postgres, MinIO, and Mailpit with Docker Compose.
  -h, --help     Show this help.

Environment:
  FRONTEND_HOST  Vite host, default 0.0.0.0
  FRONTEND_PORT  Vite port, default 5173
  HOST           Backend host, default 0.0.0.0
  PORT           Backend port, default 8089
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install)
      INSTALL_DEPS=1
      shift
      ;;
    --infra)
      START_INFRA=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v pnpm >/dev/null 2>&1 || {
  echo "pnpm is required. Install it or enable Corepack for Node.js." >&2
  exit 1
}

cd "$ROOT_DIR"

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
BACKEND_HOST="${HOST:-0.0.0.0}"
BACKEND_PORT="${PORT:-8089}"

export HOST="$BACKEND_HOST"
export PORT="$BACKEND_PORT"
export FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-http://localhost:${FRONTEND_PORT}}"

if [[ "$INSTALL_DEPS" -eq 1 || ! -d node_modules || ! -d frontend/node_modules || ! -d backend/node_modules ]]; then
  pnpm install
fi

if [[ "$START_INFRA" -eq 1 ]]; then
  command -v docker >/dev/null 2>&1 || {
    echo "Docker is required for --infra." >&2
    exit 1
  }

  docker compose -f deploy/docker-compose.yml up -d postgres minio mailpit
fi

cleanup() {
  trap - INT TERM EXIT
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}

trap cleanup INT TERM EXIT

echo "Starting BestBudget natively..."
echo "Backend:  http://localhost:${BACKEND_PORT}"
echo "Frontend: http://localhost:${FRONTEND_PORT}"
echo

pnpm --dir backend start &
BACKEND_PID=$!

pnpm --dir frontend dev --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

wait -n "$BACKEND_PID" "$FRONTEND_PID"
EXIT_CODE=$?
cleanup
exit "$EXIT_CODE"
