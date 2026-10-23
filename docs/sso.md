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

### Системные роли из групп OIDC

По умолчанию системная роль BestBudget (`admin` или `user`) назначается локально. Чтобы доверить её настроенному OIDC-провайдеру,
задайте **все три** переменные и перезапустите приложение:

```dotenv
OIDC_GROUPS_CLAIM=groups
OIDC_USER_GROUP=app-bestbudget-users
OIDC_ADMIN_GROUP=app-bestbudget-admins
```

В профиле провайдера claim `groups` должен быть массивом строк с точными именами групп. Это буквальное имя claim верхнего уровня,
без обхода вложенных полей. При необходимости добавьте `groups` в `OIDC_SCOPES` и настройте соответствующий mapping в IdP.

- Член `app-bestbudget-admins` получает системную роль `admin`; включать его также в users-группу не требуется.
- Член только `app-bestbudget-users` получает `user`. Если присутствуют обе группы, приоритет у `admin`.
- Отсутствующий или некорректный claim, а также отсутствие обеих групп запрещают SSO-вход и создание аккаунта.
- Роль синхронизируется перед выдачей сессии при каждом успешном SSO-входе. Понижение `admin` → `user` допускается,
  только если останется другой активный (не заблокированный) системный администратор.
  Простая привязка SSO к открытому локальному аккаунту роль не меняет; войдите через SSO для синхронизации.
- Настройка действует для единственного OIDC-провайдера BestBudget, независимо от хранения его подключения в ENV или БД.
  Локальный вход и его роли сохраняют прежнее поведение. Автоматического связывания аккаунтов по e-mail нет.
- Системная роль не меняет членство или роли `owner/admin/member` внутри семей и не даёт доступ к чужим финансам.

Роль берётся только из проверенного профиля провайдера и записывается сервером. Поле `role` в запросах регистрации/изменения
профиля и произвольный одноимённый claim не дают административных прав. Не ослабляйте проверку токена или настройку `input: false`.

Синхронизация не опрашивает IdP в фоне: изменение группы вступает в силу при следующем SSO-входе. Существующие сессии используют
текущую роль из БД, но удаление всех групп в IdP само по себе не отзывает сессии BestBudget. Для немедленного прекращения доступа
отзовите сессии/заблокируйте аккаунт в BestBudget. Сохраните аварийный локальный доступ перед включением mapping: неверное имя claim
или группы может закрыть SSO для всех администраторов.

### Защита последнего администратора

Если группы требуют роль `user`, но понижение оставит приложение без активных системных администраторов, BestBudget
сохраняет роль `admin` и разрешает вход. Заблокированные администраторы не считаются резервом. Проверка, запись роли и аудит
выполняются в одной транзакции: OIDC-синхронизации сериализуются транзакционной advisory-блокировкой, строки активных
администраторов заблокированы до завершения операции. Два одновременных входа не могут понизить двух последних администраторов.
Новые OIDC-пользователи по умолчанию получают `user`; повышение до `admin` из разрешённой группы сохраняется.

Заблокированная попытка записывается как `oidc.role_demotion_blocked` без e-mail, имени или claims в серверных логах.
На всех вкладках админки показывается предупреждение ru/en с именем настроенной admin-группы. Оно сохраняется после перезагрузки
и снимается после успешной синхронизации: восстановления admin-группы или допустимого понижения при наличии другого активного
администратора. Разрешение каждой попытки фиксируется аудитом `oidc.role_demotion_resolved` со ссылкой на исходное событие.

Добавьте администратора в `OIDC_ADMIN_GROUP` у провайдера и войдите через SSO повторно. Рекомендуется держать отдельного
локального администратора для восстановления. CLI может повысить и разблокировать существующий аккаунт:

```bash
docker compose exec app node dist-scripts/admin.mjs promote recovery@example.com
```

При SSO-only режиме включите `AUTH_FORCE_LOCAL_LOGIN=true` и перезапустите приложение; при необходимости задайте локальный
пароль командой `admin.mjs reset-password recovery@example.com` или создайте отдельного локального администратора через
`admin.mjs create-admin`. При следующем SSO-входе роль снова синхронизируется с группами с защитой последнего администратора.
Отсутствие обеих разрешённых групп или некорректный claim по-прежнему запрещают SSO-вход: сохранение роли не отменяет проверку
доступа провайдером. Для этого случая используйте резервный локальный вход.

Для Helm используйте `oidc.roleMapping.groupsClaim`, `oidc.roleMapping.userGroup`, `oidc.roleMapping.adminGroup`.

### Пример для Authentik

Создайте группы `app-bestbudget-users` и `app-bestbudget-admins` и OAuth2/OIDC provider с confidential-клиентом,
Authorization Code, ключом подписи и точным redirect URI `https://budget.example.com/api/auth/callback/oidc`.
У приложения должен быть доступ хотя бы для одной из этих групп; администратору достаточно admins-группы.

В provider выберите scope mappings `openid`, `email` и `profile`. Стандартный Authentik `profile` включает `groups`
как массив имён групп. Убедитесь, что claims включены в подписанный ID token. Для отдельного scope `groups` можно
создать [OAuth2 scope mapping](https://docs.goauthentik.io/add-secure-apps/providers/property-mappings/), выбрать его
в provider и вернуть только нужные приложению группы:

```python
return {"groups": [group.name for group in request.user.groups.all()
                   if group.name in ("app-bestbudget-users", "app-bestbudget-admins")]}
```

В этом случае пример окружения BestBudget:

```dotenv
OIDC_ISSUER=https://auth.example.com/application/o/bestbudget/
OIDC_CLIENT_ID=bestbudget
# Set OIDC_CLIENT_SECRET through your deployment's secret store.
OIDC_SCOPES=openid profile email groups
OIDC_ALLOW_SIGNUP=false
OIDC_GROUPS_CLAIM=groups
OIDC_USER_GROUP=app-bestbudget-users
OIDC_ADMIN_GROUP=app-bestbudget-admins
```

Сохраните реальные Client ID и Client Secret из provider; не используйте пример как готовый секрет.
Если используете стандартный mapping `profile`, отдельный scope `groups` не нужен: задайте `OIDC_SCOPES=openid profile email`.
`OIDC_ALLOW_SIGNUP=false` сохраняет требование приглашения для нового аккаунта даже при наличии разрешённой группы.
Для уже привязанного аккаунта приглашение не требуется. Сначала проверьте вход отдельным пользователем и повышение/понижение
его системной роли, затем включайте mapping для остальных. [Документация OAuth2 provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/).

### Обновление с beta.3 и кандидата PR #10

PR #10 (`617d71e263160ecd5fb8fde558d779bc080fe36f`) не добавлял миграций: он использовал существующее `users.role`.
Его цепочка заканчивается `0007_statement_import`; в beta.3 уже есть `0008_user_locale` и `0009_recipient_last_seen_locale`.
В переносе сохранены SQL, имена и timestamps журнала Drizzle; новой миграции для ролей нет.

- С beta.3 мигратор не выполняет SQL повторно: все записи уже есть в `drizzle.__drizzle_migrations`.
- С кандидата PR #10 применяются только существующие `0008–0009`: добавляются настройки языка, для старых профилей
  без явного выбора сохраняется русский язык фоновых сообщений. Роли, OIDC `sub`, локальные пароли, сессии и финансовые данные не меняются.
- Повторный запуск безопасен благодаря журналу Drizzle. Не удаляйте его и не добавляйте вручную записи о неприменённых миграциях.

Интеграционный тест `tests/integration/oidc-upgrade.test.ts` использует production-мигратор и исторические SQL-hash/timestamps
обеих версий; проверяет обновление заполненной БД, сохранение данных и повторный запуск. Перед реальным обновлением сохраните
бэкап и прежние секреты шифрования. ENV и Helm-формат mapping совместимы с кандидатом.

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
