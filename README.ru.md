# BestBudget

[English](README.md) | Русский

Self-hosted приложение для семейных финансов: план и факт, регулярные платежи и прогноз кассовых разрывов. Создано с учётом российского банковского рынка; можно использовать в любой стране со своей валютой и часовым поясом семьи.

[![CI](https://github.com/mambastick/bestbudget/actions/workflows/ci.yml/badge.svg)](https://github.com/mambastick/bestbudget/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mambastick/bestbudget?include_prereleases)](https://github.com/mambastick/bestbudget/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**1.0.0-beta.2 — бета-версия.** Интерфейс и подробная документация сейчас на русском языке.

## Скриншоты

Вымышленные демо-данные, светлая тема. Без банковских реквизитов и настоящих семейных финансов.

![Обзор: баланс, плановые платежи и прогноз на месяц](docs/screenshots/readme/dashboard.png)

<details>
<summary>Календарь, график ипотеки и цели на телефоне</summary>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/readme/calendar-dark.png">
  <img src="docs/screenshots/readme/calendar.png" alt="Календарь с платежами и прогнозом остатка по дням">
</picture>
![Ипотека: остаток долга, график платежей и симулятор досрочки](docs/screenshots/readme/loan.png)
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/readme/goals-mobile-dark.png">
  <img src="docs/screenshots/readme/goals-mobile.png" width="375" alt="Цели накопления на мобильном экране 375 px">
</picture>

</details>

## Возможности

- **Учёт и планирование:** доходы, расходы, переводы, запланированные/выполненные/пропущенные операции, поиск, фильтры и экспорт CSV. Факт в отчётах отделён от прогноза.
- **Регулярные платежи:** ежедневные, еженедельные, ежемесячные и ежегодные расписания; несколько дат зарплаты; подтверждение фактической суммы/даты, пропуск одного начисления или изменение будущих.
- **Календарь и денежный поток:** прогноз остатка по дням, ближайшие обязательства и предупреждения о кассовых разрывах; месячные бюджеты категорий без блокировки операций.
- **Мультивалютность:** счета и переводы с отдельными суммами списания/зачисления; отчёты в базовой валюте семьи; кеш курсов ЦБ РФ или ручные курсы для изолированных установок.
- **Кредиты:** ипотека и потребкредиты, аннуитетный/дифференцированный график, тело и проценты отдельно, досрочка, смена ставки, сверка долга и лимиты кредитных карт.
- **Цели:** распределение накопительного счёта, ручные взносы, подушка по истории расходов, прогноз достижения и регулярные плановые пополнения.
- **Импорт выписок:** мастер колонок CSV/XLSX, предпросмотр, проверка дублей, свои переводы, подтверждение плановых, правила категорий и отмена партии. [Инструкция](docs/import.md).
- **Напоминания:** Telegram и Web Push по подписке о платежах, просрочке, кассовом разрыве и превышении бюджета; тихие часы и ежедневная сводка. [Уведомления](docs/notifications.md).
- **Семья и доступ:** несколько пространств, одноразовые приглашения, роли owner/admin/member, пароль и универсальный OIDC SSO. Системный администратор управляет установкой без доступа к финансам чужих семей.
- **Эксплуатация:** бэкапы PostgreSQL по расписанию, выгрузка в S3, Docker Compose и Helm; адаптивный интерфейс, светлая/тёмная темы и устанавливаемая PWA. PWA не кеширует финансовые страницы для работы без сети.

## Быстрый старт — Docker Compose

Нужны Docker Engine с Compose v2 и Linux-сервер/NAS. Checkout исходников не требуется. После публикации релиза:

```bash
mkdir bestbudget && cd bestbudget
curl -fL https://raw.githubusercontent.com/mambastick/bestbudget/v1.0.0-beta.2/compose.yaml -o compose.yaml
curl -fL https://raw.githubusercontent.com/mambastick/bestbudget/v1.0.0-beta.2/.env.example -o .env
mkdir -p backups
chmod 600 .env
```

Заполните четыре значения в `.env`:

| Переменная | Значение |
|---|---|
| `APP_URL` | Адрес в браузере, например `http://192.168.1.10:3000` или `https://budget.example.com` |
| `BETTER_AUTH_SECRET` | Результат `openssl rand -base64 32` |
| `POSTGRES_PASSWORD` | Результат `openssl rand -hex 16` |
| `SETUP_TOKEN` | Отдельный результат `openssl rand -hex 16` |

На Linux задайте `LOCAL_UID`/`LOCAL_GID` числовым результатом `id -u` / `id -g`, если ваш обычный пользователь отличается от `1000:1000`. Создайте `backups` от его имени; при установке от root выполните `chown 1000:1000 backups`.

```bash
docker compose up -d
```

Откройте `APP_URL/setup`, введите `SETUP_TOKEN` и создайте первого администратора. Создайте семейное пространство, затем пригласите семью через **Настройки → Семья**. После появления администратора первичная настройка закрывается; `SETUP_TOKEN` можно удалить.

Compose загружает `ghcr.io/mambastick/bestbudget:1.0.0-beta.2` (amd64/arm64), автоматически применяет миграции и хранит PostgreSQL в томе `pgdata`. Проверка состояния: `/api/health`.

Для доступа через интернет используйте HTTPS reverse proxy. Укажите внешний адрес в `APP_URL`; передавайте `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`. Включайте `TRUST_PROXY=true` только за доверенным прокси; при прокси на том же сервере задайте `APP_BIND=127.0.0.1`. [Прокси и SSO](docs/sso.md).

## Kubernetes — Helm

Нужны ingress-контроллер, настройка TLS и постоянное хранилище. Бэкапы по расписанию требуют Kubernetes 1.27+.

```bash
helm install bestbudget oci://ghcr.io/mambastick/charts/bestbudget --version 1.0.0-beta.2 \
  --namespace bestbudget --create-namespace \
  --set appUrl=https://budget.example.com \
  --set ingress.enabled=true --set ingress.className=nginx --set ingress.tls.enabled=true
```

Helm выведет инструкцию получения токена настройки. Сгенерированные секреты сохраняются при обновлении. Внешний PostgreSQL, готовые Secret, диски и все параметры — в [README чарта](deploy/helm/bestbudget/README.md).

## Конфигурация

Полный список — в [`.env.example`](.env.example). Дополнительные сервисы также настраиваются в админке там, где это предусмотрено.

| Переменная окружения | По умолчанию / назначение |
|---|---|
| `BESTBUDGET_VERSION` | `1.0.0-beta.2`; тег образа Compose |
| `APP_URL` | Обязательный внешний URL; cookie, проверка Origin, приглашения и callback SSO |
| `BETTER_AUTH_SECRET`, `SETUP_TOKEN` | Обязательный секрет сессий и токен первоначальной настройки |
| `ENCRYPTION_KEY` | Необязательный; иначе производится от `BETTER_AUTH_SECRET`. Сохраняйте для восстановления зашифрованных настроек |
| `POSTGRES_*`, `DATABASE_URL` | Доступ к БД Compose; `DATABASE_URL` нужен при запуске вне Compose |
| `APP_PORT`, `APP_BIND`, `TRUST_PROXY` | `3000`, `0.0.0.0`, `false`; сеть и доверенный прокси |
| `FX_PROVIDER` | `cbr`; `none` отключает сетевые запросы курсов, сохраняя кеш/ручные значения |
| `BACKUP_ENABLED` | `true`; `false` выключает автоматические дампы Compose, ручные команды бэкапа/восстановления доступны |
| `TZ`, `BACKUP_TIME`, `BACKUP_PATH`, `BACKUP_KEEP_*` | `Europe/Moscow`, `03:00`, `./backups`, последние 7 плюс все за 30 дней; [бэкапы](docs/backup.md) |
| `BACKUP_S3_BUCKET`, `AWS_*`, `BACKUP_S3_*` | Необязательная выгрузка S3; [настройка](docs/backup.md#s3) |
| `JOBS_ENABLED` | `true`; встроенный планировщик напоминаний |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_MODE` | Пусто / polling; админка или ENV; [уведомления](docs/notifications.md) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Необязательная замена; иначе пара ключей создаётся и сохраняется; [Web Push](docs/notifications.md#web-push) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_ALLOW_SIGNUP` | Пустой issuer использует настройки UI; новые SSO-аккаунты по умолчанию требуют приглашения; [SSO](docs/sso.md) |
| `AUTH_FORCE_LOCAL_LOGIN` | `false`; аварийное восстановление входа по паролю |
| `SMTP_URL`, `SMTP_FROM` | Необязательный самостоятельный сброс пароля; иначе пароль сбрасывает администратор |

## Импорт выписок

Откройте **Операции → Импорт выписки**, загрузите CSV/XLSX и сопоставьте колонки и счета. Перед записью проверьте предпросмотр: дубли и свои переводы, совпадения с плановыми операциями, категории. Для похожих покупок сохраняйте правила категорий, для повторных выгрузок — профили колонок семьи.

Партия записывается атомарно; история позволяет отменить неизменённые импортированные операции и восстановить подтверждённые планы. Банковские холды пропускаются до проводки банком. Поддерживаются BestBudget CSV v1 и обратный импорт экспорта; банковские профили **экспериментальные** и требуют проверки предпросмотра. **PDF не поддерживается**; старый XLS сначала сохраните как CSV/XLSX. [Мастер, форматы и ограничения отмены](docs/import.md).

<details>
<summary>Предпросмотр импорта выписки</summary>

![Предпросмотр выписки с дублями, своими переводами и совпадениями плановых платежей](docs/screenshots/import/import-preview-desktop.png)

</details>

## Обновление и бэкапы

Прочитайте [CHANGELOG](CHANGELOG.md) и сделайте копию с помощью установленной версии:

```bash
docker compose run --rm backup now
# Set BESTBUDGET_VERSION=1.0.0-beta.2 in .env and update compose.yaml from the release tag.
docker compose pull
docker compose up -d
```

Миграции применяются автоматически, в том числе при переходе с beta.1. Сохраняйте прежнюю версию, `.env` и секреты шифрования/сессий вместе с копией. Автоматического отката схемы нет.

Бэкап БД — ответственность администратора. Встроенные дампы удобны, если своих бэкапов нет; если вы уже бэкапите PostgreSQL (снапшоты, pgBackRest, Velero, CloudNativePG или managed БД), задайте `BACKUP_ENABLED=false` в Compose или `backup.enabled=false` в Helm. В Compose они включены по умолчанию, в Helm — выключены. **При обновлении Helm задайте `backup.enabled=true` явно, если пользуетесь встроенными бэкапами.** Логический дамп полезен для переноса на другой сервер: версия приложения есть в имени, миграции выполняются при запуске приложения после restore.

При включённом расписании Compose делает бэкапы ночью в 03:00 по `TZ`, сохраняя последние 7 копий плюс все за последние 30 дней. Держите копию вне сервера и проверяйте восстановление в отдельную БД. [Бэкапы, S3 и восстановление](docs/backup.md).

## Безопасность

- Публичная регистрация и создание SSO-аккаунтов без приглашения по умолчанию выключены. Используйте приглашения; открывайте регистрацию осознанно.
- Сохраняйте `BETTER_AUTH_SECRET` и `ENCRYPTION_KEY`. Секреты OIDC/Telegram/push зашифрованы; смена ключа делает существующие зашифрованные настройки нечитаемыми. Защитите `.env`.
- Привяжите SSO к аккаунту администратора перед отключением пароля. Непригодная конфигурация SSO включает парольный вход; при недоступности самого провайдера может потребоваться `AUTH_FORCE_LOCAL_LOGIN=true` и перезапуск контейнера. Совпадение e-mail не связывает аккаунты автоматически. [Восстановление и CLI](docs/sso.md).
- Для удалённого доступа используйте HTTPS. Telegram, службы push и провайдер курсов получают запросы только для включённых возможностей; банковские логины и пароли не нужны.

## Разработка

Node.js 22+ и pnpm 10.27.0. Docker необязателен: `db:dev` запускает PGlite через протокол PostgreSQL.

```bash
npx -y pnpm@10.27.0 install --frozen-lockfile
cp .env.example .env
# Set APP_URL=http://localhost:3300, DATABASE_URL=postgres://postgres@127.0.0.1:54340/postgres,
# BETTER_AUTH_SECRET and SETUP_TOKEN in .env.
PGLITE_PORT=54340 npx -y pnpm@10.27.0 db:dev
# In another terminal:
npx -y pnpm@10.27.0 db:migrate
PORT=3300 npx -y pnpm@10.27.0 dev
```

| Команда (с префиксом `npx -y pnpm@10.27.0`) | Назначение |
|---|---|
| `typecheck`, `lint`, `test` | TypeScript, ESLint, Vitest с отдельным PGlite и настоящими миграциями |
| `build` | Production standalone и консольные утилиты администрирования/бэкапа |
| `test:e2e` | Playwright на production; отдельные порты **3200/54330**, должны быть свободны |
| `db:generate --name <name>` | Создание аддитивной миграции после изменения схемы |
| `db:seed-demo <email>` | Шесть месяцев вымышленных данных; нужны пустая RUB-семья и единственный стандартный счёт. Включает синтетические курсы; только для демо-БД |
| `test:screenshots readme.spec.ts` | Переснять README и проверить страницы при 1280/375 px в обеих темах |

Установите браузер один раз: `npx -y pnpm@10.27.0 exec playwright install chromium`. Для своего Chromium задайте `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Helm: `./scripts/check-helm.sh`. Docker smoke с бэкапом и восстановлением выполняется в CI.

## Архитектура и участие

Next.js 16 App Router · React 19 · TypeScript strict · Tailwind 4 · shadcn/Base UI · Drizzle · PostgreSQL 17 · Better Auth · Recharts.

[Архитектура и модель данных](docs/architecture.md). Деньги — целые минорные единицы; даты относятся к часовому поясу семьи; финансовые ссылки гарантируют изоляцию пространств. Логика — в сервисах, server actions валидируют вход и возвращают структурированный результат.

Issues и PR приветствуются. Опишите проблему и воспроизведение; приложите результаты проверок и скриншоты для UI. Миграции — аддитивные, UI-компоненты — существующие, тяжёлые зависимости — по необходимости. Тексты интерфейса — русские; код и комментарии — английские. Не прикладывайте настоящие выписки, секреты и персональные финансовые данные к публичным issues.

## Планы

- Проверить нативные профили Сбера, Т-Банка и Альфа-Банка на локально обезличенных реальных выписках. Текущие банковские форматы остаются экспериментальными; доступен мастер колонок.
- Необязательные вложения IMAP и **черновики** из Android SMS/push с проверкой пользователя перед записью.
- Следить за доступностью Open Banking РФ для self-hosted клиентов; прямой API розничных банков и срок его появления не обещаем. [Исследование банков](docs/research/bank-integrations-ru.md), [форматы выписок](docs/research/statement-formats.md).

## Лицензия

[MIT](LICENSE), copyright © 2026 BestBudget.
