#!/bin/sh
set -eu
cd "$(dirname -- "$0")/.."
chart=deploy/helm/bestbudget
check() {
  helm lint "$chart" --strict --set appUrl=https://budget.example.com "$@"
  helm template bb "$chart" --set appUrl=https://budget.example.com "$@" >/dev/null
}
check --set ingress.enabled=true
check --set postgresql.enabled=false --set externalDatabase.url=postgres://budget:example@db.example.com:5432/budget
check --set backup.enabled=false
check --set backup.s3.enabled=true --set backup.s3.bucket=backups --set backup.s3.existingSecret=s3-backups
check --set postgresql.enabled=false --set existingSecret=app-secrets --set backup.persistence.existingClaim=backup-data
check --set oidc.roleMapping.groupsClaim=groups --set oidc.roleMapping.userGroup=app-budget-users --set oidc.roleMapping.adminGroup=app-budget-admins
if helm template bb "$chart" --set appUrl=https://budget.example.com --set oidc.roleMapping.groupsClaim=groups >/dev/null 2>&1; then
  echo "Partial OIDC role mapping must fail to render" >&2
  exit 1
fi
