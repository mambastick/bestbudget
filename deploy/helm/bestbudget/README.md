# BestBudget Helm chart

Self-hosted family budget: income, expenses, recurring payments and cash-flow forecast.

```bash
helm install bestbudget oci://ghcr.io/mambastick/charts/bestbudget --version 1.0.1 \
  --namespace bestbudget --create-namespace \
  --set appUrl=https://budget.example.com \
  --set ingress.enabled=true --set ingress.className=nginx --set ingress.tls.enabled=true
```

| Value | Default | Description |
|---|---|---|
| `appUrl` | — | **Required.** Public URL of the app (cookies, CSRF, invitation links, SSO callback). |
| `image.repository` / `image.tag` | `ghcr.io/mambastick/bestbudget` / appVersion | Container image. |
| `replicaCount` | `1` | App replicas (migrations are serialized with an advisory lock). |
| `auth.secret`, `auth.setupToken`, `auth.encryptionKey` | generated | Kept across upgrades when generated. |
| `auth.trustProxy` | `true` | Use `X-Forwarded-For` from the ingress for client IPs. |
| `auth.forceLocalLogin` | `false` | Emergency access: force password login on. |
| `existingSecret` | `""` | Secret with `BETTER_AUTH_SECRET`, `SETUP_TOKEN`, `DATABASE_URL` (+ optional `ENCRYPTION_KEY`, `OIDC_CLIENT_SECRET`, `SMTP_URL`). |
| `oidc.*` | empty | OpenID Connect provider; empty issuer = configure SSO in the admin UI. |
| `smtp.url`, `smtp.from` | empty | E-mail for self-service password reset. |
| `postgresql.enabled` | `true` | Bundled single-instance PostgreSQL (StatefulSet + PVC). |
| `postgresql.persistence.size` | `5Gi` | Database volume size. |
| `backup.enabled`, `backup.schedule`, `backup.timeZone` | `true`, `0 3 * * *`, `Etc/UTC` | Scheduled custom-format dumps (Kubernetes >= 1.27). |
| `backup.retention.keepLast`, `backup.retention.keepDays` | `7`, `30` | Keep the union of the newest N dumps and all dumps younger than N days. |
| `backup.persistence.*` | `5Gi`, default storage class | Separate PVC, optional `existingClaim`; generated PVC is kept on uninstall. |
| `backup.s3.*` | disabled | AWS CLI upload; credentials from `existingSecret`, remote retention via bucket lifecycle. |
| `backup.resources`, `backup.s3.resources` | see values.yaml | Dump and upload resource limits. |
| `externalDatabase.url` | `""` | Used when `postgresql.enabled=false`. |
| `ingress.*` | disabled | Host defaults to the host of `appUrl`; TLS secret defaults to `<release>-bestbudget-tls`. |
| `resources`, `nodeSelector`, `tolerations`, `affinity`, `podAnnotations` | | Usual scheduling settings. |

The first administrator is created at `/setup` with the setup token:

```bash
kubectl -n bestbudget get secret bestbudget -o jsonpath='{.data.SETUP_TOKEN}' | base64 -d; echo
```

Настройка, ручной бэкап, проверка и восстановление из PVC: [docs/backup.md](../../../docs/backup.md).
