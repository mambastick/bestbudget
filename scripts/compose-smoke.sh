#!/usr/bin/env bash
# CI smoke test of the Docker Compose deployment: builds the image, starts the stack, creates an
# administrator and checks that the data survives a restart and a container re-creation.
set -euo pipefail

cp .env.example .env
sed -i \
  -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -base64 32)|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" \
  -e "s|^SETUP_TOKEN=.*|SETUP_TOKEN=$(openssl rand -hex 16)|" \
  .env

health() { curl -fsS http://127.0.0.1:3000/api/health; echo; }
admins() { docker compose exec -T app node dist-scripts/admin.mjs list-admins; }

docker compose up -d --build --wait --wait-timeout 180
health
curl -fsS -o /dev/null -w "setup page: %{http_code}\n" http://127.0.0.1:3000/setup

docker compose exec -T -e ADMIN_EMAIL=smoke@example.com -e ADMIN_PASSWORD=smoke-password-123 app node dist-scripts/admin.mjs create-admin
admins | grep -q smoke@example.com

docker compose restart app
docker compose up -d --wait --wait-timeout 120
admins | grep -q smoke@example.com
echo "data survived restart"

docker compose down
docker compose up -d --wait --wait-timeout 180
admins | grep -q smoke@example.com
health
echo "data survived re-creation"

docker compose down -v
