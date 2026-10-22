# BestBudget

Self-hosted веб-приложение для совместного ведения семейного бюджета: доходы, расходы, регулярные платежи, счета, бюджеты по категориям,
финансовый календарь и прогноз остатка. Несколько пользователей работают в общем семейном пространстве, вход — по паролю и/или через SSO
(OpenID Connect).

**Стек:** Next.js 16 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui (Base UI) · PostgreSQL · Drizzle ORM ·
Better Auth · Recharts · Zod · Vitest · Playwright · Docker Compose.

## Возможности

- **Семейные пространства** с ролями «Владелец», «Администратор», «Участник»; приглашения по одноразовой ссылке; несколько пространств у
  одного пользователя; автор каждой операции.
- **Операции:** доходы, расходы, переводы между своими счетами. Статусы «запланирована» / «выполнена» / «пропущена». Поиск и фильтры.
- **Регулярные операции:** ежедневно/еженедельно/ежемесячно/ежегодно с интервалом, датой начала и окончания; несколько начислений в месяц
  (зарплата 5-го и 20-го); корректная обработка 29–31 числа. Каждое начисление сначала плановое — подтвердите его, изменив при необходимости
  сумму и дату; можно пропустить, изменить только одно или все следующие, остановить расписание.
- **Обзор:** фактический баланс, доходы и расходы месяца, ожидаемые поступления и платежи, прогноз на конец месяца, свободные средства после
  обязательных платежей, графики, ближайшие операции, предупреждение о кассовом разрыве.
- **Календарь** с прогнозом остатка на конец каждого дня и подсветкой дней с отрицательным балансом.
- **Бюджеты** — необязательные месячные лимиты по категориям (предупреждение, без блокировки).
- **Счета** — наличные, карты, накопительные, кредитные карты (без двойного учёта расходов).
- **Аналитика** за период с сравнением с предыдущим, крупнейшие категории, динамика накоплений; прогноз — отдельно.
- **Администрирование:** пользователи (блокировка, роли, сброс пароля, завершение сеансов), пространства без доступа к их финансам, способы
  входа, SSO, журнал системных событий.
- Светлая и тёмная темы, адаптивный интерфейс, русская локализация; анимации на [Animate UI](https://animate-ui.com) (Motion) и
  [React Bits](https://reactbits.dev).

## Быстрый старт (Docker Compose)

```bash
cp .env.example .env
mkdir -p backups
```

Заполните в `.env` обязательные значения:

```bash
openssl rand -base64 32   # → BETTER_AUTH_SECRET
openssl rand -hex 16      # → POSTGRES_PASSWORD
openssl rand -hex 16      # → SETUP_TOKEN
```

и `APP_URL` — адрес, по которому приложение открывают в браузере (например, `http://192.168.1.10:3000` или `https://budget.example.com`).

```bash
docker compose up -d
```

По умолчанию используется готовый образ `ghcr.io/mambastick/bestbudget` нужной версии (`BESTBUDGET_VERSION` в `.env`).
Собрать образ из исходников: `docker build -t ghcr.io/mambastick/bestbudget:1.0.0-beta.1 .`.

1. Откройте `APP_URL` — приложение перенаправит на `/setup`.
2. Введите `SETUP_TOKEN`, имя, e-mail и пароль — будет создан системный администратор.
3. Создайте семейное пространство (базовые категории и основной счёт создаются автоматически).
4. **Настройки → Семья → Пригласить** — отправьте одноразовую ссылку супругу или супруге.

Миграции базы применяются автоматически при каждом старте контейнера. Данные PostgreSQL хранятся в томе `pgdata` и переживают перезапуск
и пересоздание контейнеров. Проверка состояния: `GET /api/health`.

### Бэкапы

Включены по умолчанию: каждую ночь в 03:00 по `TZ` (`Europe/Moscow`), файлы лежат в `./backups`.
Хранятся последние 7 копий плюс все за 30 дней. Перед первым запуском создайте `backups`; UID/GID контейнеров — `1000:1000` (для другого владельца задайте `LOCAL_UID`/`LOCAL_GID`).

```bash
docker compose run --rm backup now
docker compose run --rm backup list
docker compose stop app && docker compose run --rm backup restore backups/ИМЯ-ФАЙЛА.dump --yes && docker compose start app
```

S3 включается через `BACKUP_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; [настройки, статус и Kubernetes](docs/backup.md).

### Обновление

```bash
docker compose pull && docker compose up -d
```

Миграции применяются автоматически. Перед обновлением сделайте резервную копию.

## Kubernetes (Helm)

Чарт публикуется в GHCR как OCI-артефакт. Минимальная установка со встроенным PostgreSQL и Ingress:

```bash
helm install bestbudget oci://ghcr.io/mambastick/charts/bestbudget --version 1.0.0-beta.1 \
  --namespace bestbudget --create-namespace \
  --set appUrl=https://budget.example.com \
  --set ingress.enabled=true --set ingress.className=nginx --set ingress.tls.enabled=true
```

После установки `helm` выведет команду для получения `SETUP_TOKEN` — с ним откройте `https://budget.example.com/setup`.

- Секреты (`BETTER_AUTH_SECRET`, `SETUP_TOKEN`, пароль PostgreSQL) генерируются при установке и сохраняются при `helm upgrade`.
  Можно передать свой Secret: `--set existingSecret=bestbudget-secrets`.
- Внешняя база: `--set postgresql.enabled=false --set externalDatabase.url=postgres://user:pass@host:5432/bestbudget`.
- SSO: `oidc.issuer`, `oidc.clientId`, `oidc.clientSecret` (или настройка из интерфейса, если `oidc.issuer` пустой).
- Под приложения запускается без root, с read-only файловой системой; readiness-проба проверяет базу, liveness — нет.
- Все параметры — в [deploy/helm/bestbudget/values.yaml](deploy/helm/bestbudget/values.yaml).

Из исходников: `helm install bestbudget deploy/helm/bestbudget --set appUrl=...`.

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
  администратора; если SSO перестаёт быть доступным, вход по паролю включается автоматически.
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

## Разработка

Нужны Node.js 22+ и pnpm 10. Docker для разработки не обязателен: локальная база — встроенный PostgreSQL (PGlite) поверх обычного
протокола.

```bash
pnpm install
cp .env.example .env    # DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres, APP_URL=http://localhost:3000, секреты
pnpm db:dev             # PGlite на порту 54329, данные в .data/pglite
pnpm db:migrate
pnpm dev
```

Можно использовать и обычный PostgreSQL: `docker compose up -d db` и `DATABASE_URL=postgres://bestbudget:<password>@localhost:5432/bestbudget`
(откройте порт 5432 в `compose.yaml` или подключитесь иначе).

| Команда | Назначение |
|---|---|
| `pnpm test` | unit- и интеграционные тесты (Vitest, реальные миграции на in-memory PostgreSQL) |
| `pnpm test:e2e` | сквозной сценарий в браузере (Playwright, production-сборка). Локальный Chromium: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium` |
| `pnpm typecheck`, `pnpm lint` | проверки |
| `pnpm db:generate` | создать миграцию после изменения `src/db/schema.ts` |
| `pnpm db:seed-demo <e-mail>` | заполнить первое пространство пользователя демо-данными (только для разработки) |
| `pnpm build` | production-сборка (`.next/standalone`) и консольные скрипты (`dist-scripts`) |

Устройство приложения, модель данных и решения — в [docs/architecture.md](docs/architecture.md).
