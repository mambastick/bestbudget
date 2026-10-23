# SSO, reverse proxy и восстановление доступа

## Работа за reverse proxy

- `APP_URL` — публичный `https://` адрес: по нему формируются cookie (флаг `Secure`), проверка Origin, ссылки-приглашения и callback SSO.
- Прокси должен передавать `Host`/`X-Forwarded-Host` и `X-Forwarded-Proto`. Включите `TRUST_PROXY=true`, чтобы ограничение частоты
  попыток входа учитывало реальный IP из `X-Forwarded-For`.
- Если прокси на том же хосте, опубликуйте порт только локально: `APP_BIND=127.0.0.1`.

Пример для Caddy:

```
budget.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Пример для nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## SSO (OpenID Connect)

Поддерживается любой OIDC-провайдер с discovery-документом: Keycloak, Authentik, Microsoft Entra ID и др.

1. Создайте в провайдере клиента (confidential, Authorization Code). Redirect URI: `${APP_URL}/api/auth/callback/oidc`.
2. Настройте SSO одним из способов:
   - **Через интерфейс:** Администрирование → Авторизация. Секрет клиента хранится в PostgreSQL в зашифрованном виде (AES-256-GCM).
   - **Через окружение:** `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES`, `OIDC_DISPLAY_NAME`, `OIDC_REDIRECT_URI`.

**Приоритет источников:** если задан `OIDC_ISSUER`, используются переменные окружения, а форма в интерфейсе доступна только для чтения.
Иначе — настройки из базы. Изменения применяются без перезапуска.

Issuer для популярных провайдеров:

| Провайдер | Issuer URL |
|---|---|
| Keycloak | `https://<host>/realms/<realm>` |
| Authentik | `https://<host>/application/o/<slug>/` |
| Microsoft Entra ID | `https://login.microsoftonline.com/<tenant-id>/v2.0` |

**Связывание аккаунтов.** SSO-аккаунт никогда не связывается с существующим локальным автоматически по совпадению e-mail. Чтобы входить
через SSO в существующий аккаунт, войдите по паролю и нажмите «Привязать» в Настройки → Профиль и безопасность. Новые пользователи через SSO
создаются только по приглашению — либо всегда, если включено «Создавать аккаунты при первом входе через SSO» (`OIDC_ALLOW_SIGNUP`).
ID-токен проверяется по JWKS провайдера; используется PKCE.

## Безопасность и восстановление доступа

- Публичная регистрация выключена по умолчанию — новые пользователи приходят по приглашениям.
- Нельзя отключить последний способ входа: вход по паролю отключается только при работающем SSO, уже привязанном к аккаунту
  администратора; при отсутствующей или непригодной конфигурации SSO вход по паролю включается автоматически.
  Недоступность самого провайдера не проверяется этим механизмом: используйте аварийный доступ ниже.
- **Аварийный доступ:** `AUTH_FORCE_LOCAL_LOGIN=true` в `.env` и `docker compose up -d` принудительно включают вход по паролю.
- **Консольные команды** (внутри контейнера):

```bash
docker compose exec app node dist-scripts/admin.mjs list-admins
docker compose exec app node dist-scripts/admin.mjs reset-password user@example.com
docker compose exec app node dist-scripts/admin.mjs promote user@example.com
docker compose exec app node dist-scripts/admin.mjs enable-local-auth
docker compose exec -e ADMIN_EMAIL=admin@example.com app node dist-scripts/admin.mjs create-admin
```

- Без SMTP пароли сбрасывает администратор (временный пароль в интерфейсе). С `SMTP_URL` доступно самостоятельное восстановление по e-mail.
- Пароли хешируются scrypt; сессии — HTTP-only cookie; ограничение частоты попыток входа; заголовки CSP, `X-Frame-Options` и др.;
  проверка Origin для server actions и API авторизации; все входные данные проверяются Zod на сервере.

