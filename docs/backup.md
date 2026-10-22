# Резервное копирование и восстановление

Compose и Helm по умолчанию ежедневно в **03:00 UTC** создают сжатый `pg_dump --format=custom` PostgreSQL 17.
Пример пары файлов: `bestbudget-20261023T030000Z-v1.0.0-beta.1.dump` и такой же файл с окончанием `.dump.sha256`.
Версия берётся из тега образа приложения, если он подходит для имени файла; время в имени всегда UTC.

Дамп сначала записывается во временный каталог на том же диске, затем проверяется `pg_restore --list` и переименовывается.
Checksum публикуется последним и обозначает завершённый бэкап. Список, ротация и S3 игнорируют одиночные дампы, временные файлы и symlink.
Права новых файлов — `0600`. Дампы содержат персональные данные, хеши паролей и токены: ограничьте доступ к каталогу и бакету.

Храним **объединение** последних 7 успешных копий и всех успешных копий за последние 30 суток. Удаляется только то, что старше
30 суток **и** не входит в последние 7 копий. Для беты это проще проверять и объяснять, чем календарные daily/weekly/monthly корзины;
частые ручные копии не вытеснят недавние ежедневные. `keepLast` должен быть не меньше 1, `keepDays=0` оставляет только последние N.
Ротация удаляет только пары со строгим шаблоном имени BestBudget и их локальные квитанции `.uploaded`; другие файлы сохраняются.
Это не ограничение объёма: следите за свободным местом, особенно при частых ручных копиях.

## Docker Compose

Сервис `backup` входит в обычный `docker compose up -d --wait`. Используется `postgres:17-alpine`, как у `db`;
в контейнере работает BusyBox cron. Healthcheck проверяет запуск планировщика; **он не подтверждает успешность последнего дампа**.
Проверяйте дату последней пары файлов и `docker compose logs backup` (при S3 также `docker compose logs backup-s3`).

В `.env`:

```dotenv
BACKUP_PATH=./.data/backups
BACKUP_SCHEDULE=0 3 * * *
BACKUP_KEEP_LAST=7
BACKUP_KEEP_DAYS=30
```

Каталог `./.data/backups` создаётся bind-mount-ом рядом с `compose.yaml`; `.data/` уже исключён из Git и Docker build context.
Можно указать абсолютный путь на отдельный диск. Если выбираете другой каталог внутри checkout,
исключите его из Git и Docker build context до создания копий.
Пользователь внутри backup-контейнера — root для BusyBox cron; файлы на Linux будут принадлежать root.
Копировать их можно через `sudo`, не делайте каталог общедоступным. При заранее созданном каталоге используйте `sudo chmod 700 .data/backups`.
Если включён SELinux, настройте общий container volume label для каталога, доступного обоим контейнерам.

Расписание — пять числовых cron-полей (`*`, списки, диапазоны, шаги), дни недели `0–6` (воскресенье — `0`).
Часовой пояс Compose фиксирован **UTC**, поэтому `0 0 * * *` соответствует 03:00 в Москве. После изменения `.env`:

```bash
docker compose up -d --wait backup
```

Из корня checkout:

```bash
./scripts/backup.sh now                    # создать копию сейчас
./scripts/backup.sh list                   # имена завершённых копий, новые первыми
./scripts/backup.sh verify bestbudget-20261023T030000Z-v1.0.0-beta.1.dump
```

Эквивалент без обёртки: `docker compose run --rm --no-deps backup now` (или `list`, `verify <имя>`).
БД должна быть запущена: при необходимости `docker compose up -d --wait db`.
Скрипты доступны в checkout в `deploy/helm/bestbudget/files/backup/`; одни и те же файлы монтируются в Compose и включаются в чарт.
Checkout с этими файлами должен оставаться доступен контейнерам.

### Восстановление в Compose

1. Сохраните текущую `.env` вне сервера вместе с `BETTER_AUTH_SECRET` и `ENCRYPTION_KEY`, если он задан.
   Без прежнего ключа шифрования OIDC-секрет из БД не расшифруется. Дамп не содержит конфигурацию контейнеров и `.env`.
2. Выберите доверенную копию и положите **оба** файла в `BACKUP_PATH`. Для копии на другом диске сначала скопируйте её туда.
3. Если текущая БД доступна, перед восстановлением сделайте отдельный ручной бэкап. Остановите сторонних писателей в эту БД.
4. Выполните:

```bash
./scripts/restore.sh bestbudget-20261023T030000Z-v1.0.0-beta.1.dump --yes
```

Если включён S3 uploader, дождитесь завершения его текущей загрузки (в логах появится `Uploaded`).
Обёртка сначала проверит SHA-256 и оглавление архива, остановит `app` и планировщик `backup`, восстановит данные,
запустит `app` и `backup` с `--wait`. Миграции применяет штатный entrypoint приложения.
Без `--yes` восстановление не начинается. При ошибке приложение и планировщик остаются остановленными для повторной попытки.

Вручную, например при восстановлении на новом сервере с уже созданной пустой БД:

```bash
docker compose up -d --wait db
docker compose run --rm --no-deps backup verify bestbudget-20261023T030000Z-v1.0.0-beta.1.dump
docker compose stop app backup
docker compose run --rm --no-deps backup restore bestbudget-20261023T030000Z-v1.0.0-beta.1.dump --yes
docker compose up -d --wait app backup
```

`pg_restore --clean --if-exists --no-owner --no-acl --single-transaction` пересоздаёт объекты из дампа в одной транзакции:
SQL-ошибка откатывает и очистку, и восстановление. Роль подключения должна владеть восстанавливаемыми объектами и иметь права создавать
схемы/таблицы. Роли PostgreSQL и ACL не восстанавливаются. Объекты, отсутствующие в дампе, не удаляются: предпочтительна пустая целевая БД.
Для восстановления более старой копии запускайте ту же или более новую версию приложения; это не процедура отката схемы приложения.

После восстановления проверьте `/api/health`, вход прежнего администратора и несколько операций/счетов в интерфейсе.
`verify` проверяет SHA-256 и оглавление, но только настоящее восстановление в отдельную БД проверяет все данные и зависимости архива.

## Kubernetes / Helm

Нужен Kubernetes **1.27+**: расписание использует `CronJob.spec.timeZone`.
`backup.enabled=true` по умолчанию, как со встроенным PostgreSQL, так и с `externalDatabase.url` / `existingSecret`.
Если внешняя БД уже обслуживается провайдером, ненужный CronJob можно отключить через `backup.enabled=false`.

```yaml
backup:
  enabled: true
  schedule: "0 3 * * *"
  timeZone: Etc/UTC
  retention:
    keepLast: 7
    keepDays: 30
  persistence:
    size: 5Gi
    storageClass: ""
    accessModes: [ReadWriteOnce]
    existingClaim: ""  # использовать существующий PVC вместо создания нового
```

`backup.timeZone` можно заменить на `Europe/Moscow`; время в именах дампов останется UTC.
CronJob имеет `concurrencyPolicy: Forbid`, лимиты истории (1 успешный / 3 неуспешных Job), deadline 1 час и ограниченные повторы.
Ручные Job не охватываются `Forbid`: доступ к каталогу дополнительно сериализуется блокировкой.
Job работает без root, без service account token, с read-only rootfs и `emptyDir` `/work` для временных файлов.
Ресурсы: `backup.resources`, для выгрузки — `backup.s3.resources`; образ клиента — `backup.image` (по умолчанию PostgreSQL 17).
Клиент `pg_dump` должен быть той же или более новой major-версии, что и внешняя БД.

Подключение берётся из **того же `DATABASE_URL` в Secret**, что использует приложение. Init-контейнер на образе приложения
через Node.js URL создаёт service-файл libpq и `.pgpass` (0600) в приватном `emptyDir`; пароль не передаётся в аргументах процессов.
Поддерживаются обычные односерверные `postgres://` / `postgresql://` URI, percent-encoding и query-параметры libpq, например
`?sslmode=require`. Multihost URI, переводы строк в параметрах и переопределение `service`/`passfile` не поддерживаются.
Для нестандартных параметров TLS, требующих файлов сертификатов, потребуется добавить их монтирование в Job.
Новый пароль и новый DB Secret для бэкапов не генерируются.

Создаваемый чартом backup-PVC имеет `helm.sh/resource-policy: keep`: `helm uninstall` или отключение backup не удаляет копии.
PVC придётся удалить вручную, когда данные точно не нужны. Повторная установка после uninstall: передайте его через `existingClaim`.
Для переноса между узлами используйте подходящий CSI-драйвер; локальный PVC сам по себе не защищает от потери узла.

Примеры ниже предполагают namespace `bestbudget`, release `bestbudget`, CronJob/PVC `bestbudget-backup`.
При другом имени release проверьте реальные имена через `kubectl -n bestbudget get cronjob,pvc`.

```bash
kubectl -n bestbudget create job --from=cronjob/bestbudget-backup bestbudget-backup-manual
kubectl -n bestbudget wait --for=condition=complete job/bestbudget-backup-manual --timeout=3600s
kubectl -n bestbudget logs job/bestbudget-backup-manual --all-containers=true
```

При S3 дамп выполняется init-контейнером `backup`, а основной контейнер `upload` отправляет готовые пары; ошибка S3 делает Job неуспешным,
но локальная копия остаётся. Смотрите логи всех контейнеров, состояние Job и дату последнего дампа; отдельного сервиса оповещений чарт не включает.

### Список, проверка и восстановление из backup-PVC

Можно создать одноразовый Job из шаблона CronJob, сохранив настройки Secret, PVC и безопасности.
Нужны `kubectl` и локальный Python 3. Скрипт ниже удаляет S3-контейнер и оставляет подготовку подключения плюс одну выбранную операцию.

```bash
mkdir -p work
kubectl -n bestbudget create job bestbudget-recovery --from=cronjob/bestbudget-backup \
  --dry-run=client -o json > work/recovery-source.json
# Для списка: OP=list. Для проверки: OP=verify и FILE=<имя>.
# Для восстановления: OP=restore, FILE=<имя> и CONFIRM=--yes.
OP=list FILE='' CONFIRM='' python3 - <<'PY' > work/recovery-job.json
import json, os
with open('work/recovery-source.json') as source:
    job = json.load(source)
job['spec']['backoffLimit'] = 0
pod = job['spec']['template']['spec']
containers = pod.get('initContainers', []) + pod['containers']
backup = next(c for c in containers if c['name'] == 'backup')
operation = os.environ['OP']
assert operation in ('list', 'verify', 'restore')
args = [operation]
if operation in ('verify', 'restore'):
    assert os.environ['FILE']
    args.append(os.environ['FILE'])
if operation == 'restore':
    assert os.environ['CONFIRM'] == '--yes'
    args.append('--yes')
backup['command'] = ['sh', '/scripts/backup.sh', *args]
pod['initContainers'] = [c for c in containers if c['name'] == 'connection']
pod['containers'] = [backup]
print(json.dumps(job))
PY
kubectl -n bestbudget create -f work/recovery-job.json
kubectl -n bestbudget wait --for=condition=complete job/bestbudget-recovery --timeout=3600s
kubectl -n bestbudget logs job/bestbudget-recovery -c backup
# Сохраните нужные логи перед удалением. Для следующей операции создайте Job заново.
kubectl -n bestbudget delete job bestbudget-recovery
```

**Перед `OP=restore`** сохраните Secret приложения вне кластера, сделайте свежую копию, если это возможно, и остановите всех писателей:

```bash
kubectl -n bestbudget patch cronjob bestbudget-backup --type=merge -p '{"spec":{"suspend":true}}'
# Сохраните исходные replicas и suspend; команды выполняйте в одной shell-сессии.
replicas=$(kubectl -n bestbudget get deployment bestbudget -o jsonpath='{.spec.replicas}')
kubectl -n bestbudget scale deployment bestbudget --replicas=0
kubectl -n bestbudget wait --for=delete pod -l app.kubernetes.io/instance=bestbudget,app.kubernetes.io/component=app --timeout=180s
kubectl -n bestbudget get pods -l app.kubernetes.io/instance=bestbudget,app.kubernetes.io/component=backup
```

Дождитесь завершения всех уже запущенных backup/upload Job: `suspend` не останавливает существующие Job.
Проверьте файл через `OP=verify`, затем создайте Job с `OP=restore FILE=bestbudget-...dump CONFIRM=--yes` по примеру выше.
При ошибке оставьте приложение остановленным и разберите причину; raw stderr PostgreSQL намеренно скрыт, чтобы не вывести credentials.
Если восстановление успешно:

```bash
kubectl -n bestbudget scale deployment bestbudget --replicas="$replicas"
kubectl -n bestbudget rollout status deployment/bestbudget --timeout=300s
kubectl -n bestbudget patch cronjob bestbudget-backup --type=merge -p '{"spec":{"suspend":false}}'
```

Если CronJob изначально был приостановлен, сохраните `suspend=true`. Запуск приложения применит миграции.
Проверьте health, вход и финансовые данные. Удалите временные Job/JSON, когда логи больше не нужны.
Для восстановления на новом кластере сначала установите чарт с сохранённым Secret, `replicaCount=0`, `backup.suspend=true`,
создайте БД/PVC и перенесите пару файлов на backup-PVC (через временный Pod с этим PVC и `kubectl cp`; образ `postgres:17-alpine` содержит `tar`).
После этого используйте тот же recovery Job. Не запускайте приложение до окончания restore.

## S3-совместимое хранилище

Опциональная выгрузка использует официальный образ **AWS CLI**, без самописного HTTP-клиента.
Подходят Yandex Object Storage, Selectel, MinIO и другие сервисы с S3 API. Бакет должен существовать.
Задайте endpoint своего провайдера, например `https://storage.yandexcloud.net`, и его регион; для MinIO — доступный из контейнера адрес.
Endpoint не должен содержать пароль; credentials передаются отдельными переменными/Secret. HTTPS проверяется штатно, `--no-verify-ssl` не используется.
Для частного CA понадобится его монтирование и `AWS_CA_BUNDLE`.

Compose, в `.env`:

```dotenv
COMPOSE_PROFILES=backup-s3
BACKUP_S3_BUCKET=family-backups
BACKUP_S3_PREFIX=bestbudget
BACKUP_S3_ENDPOINT=https://storage.yandexcloud.net
BACKUP_S3_REGION=ru-central1
BACKUP_S3_ACCESS_KEY_ID=...
BACKUP_S3_SECRET_ACCESS_KEY=...
```

```bash
docker compose up -d --wait
# Немедленная выгрузка всех ожидающих копий; локальная блокировка не даст пересечься с дампом.
docker compose run --rm --no-deps backup-s3 once
```

Uploader раз в минуту отправляет готовые пары: сначала `.dump`, затем `.sha256`. Неуспешные загрузки повторяются;
локальный `.uploaded` отмечает успех для конкретного endpoint/bucket/prefix, смена назначения вызывает повторную выгрузку.
Удаление удалённого объекта вручную не сбрасывает квитанцию: для повторной отправки удалите соответствующий `.uploaded`.
Если S3 недоступен дольше локального срока хранения, старые неотправленные копии могут быть удалены обычной ротацией.

Helm:

```yaml
backup:
  s3:
    enabled: true
    bucket: family-backups
    prefix: bestbudget
    endpoint: https://storage.yandexcloud.net
    region: ru-central1
    existingSecret: bestbudget-backup-s3
```

Secret `bestbudget-backup-s3` в namespace приложения должен содержать `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
и при необходимости `AWS_SESSION_TOKEN`. Создайте его своим менеджером секретов или из защищённого файла через `kubectl create secret generic --from-env-file`;
не передавайте ключи в командной строке и не сохраняйте их в values-файлах/Git. Разрешения uploader — запись в выделенный prefix бакета.
При S3-сбое следующий успешный Job повторит загрузку оставшихся локальных пар.

**Локальная ротация не удаляет объекты S3.** Настройте lifecycle бакета отдельно (включая незавершённые multipart uploads и noncurrent versions).
Для получения копии используйте AWS CLI с тем же endpoint: `aws s3 cp s3://family-backups/bestbudget/<имя>.dump <каталог>/`
и отдельно скачайте `<имя>.dump.sha256`, сохранив имена. Пароль/ключи пусть остаются в окружении или профиле CLI.
Скачанные файлы перенесите в Compose `BACKUP_PATH` / backup-PVC и выполните обычные `verify` и `restore`.
S3-копия не шифруется самим скриптом: включите шифрование бакета и/или используйте шифрованное внешнее хранилище.

## Блокировка и прерванные операции

Дамп, ротация, restore и выгрузка используют общий каталог-блокировку `/backups/.bestbudget-lock`.
Обычное завершение и обрабатываемые сигналы снимают её; `SIGKILL`, потеря узла или питание могут оставить блокировку и `.incomplete.*`.
Автоматически снимать её по времени небезопасно: большой дамп может ещё работать.
Сначала убедитесь, что **все** операции завершены (остановите Compose `backup`/`backup-s3` или приостановите CronJob и дождитесь Job).
Только после этого удалите пустой `.bestbudget-lock` через `rmdir` из контейнера с тем же volume/PVC.
Незавершённые `.incomplete.*` и одиночный `.dump` без `.sha256` можно удалить вручную после той же проверки.
После освобождения блокировки запустите ручной бэкап и возобновите расписание. Две ручные копии в одну секунду: вторая откажется
перезаписывать существующее имя, повторите через секунду.

## Проверки и правило 3–2–1

- `./scripts/test-backup.sh`: ротация на фиктивных файлах, защита чужих файлов/symlink, незавершённый дамп, checksum,
  подтверждение restore, повтор/ошибка S3 и подготовка libpq credentials. `TMPDIR` учитывается, по умолчанию используется `/var/tmp/codex-golodn1y/bestbudget-backups`.
- `./scripts/test-backup-postgres.sh`: при наличии инструментов PostgreSQL поднимает изолированную БД на приватном Unix socket,
  применяет миграции и проверяет восстановление после потери схем, SCRAM-подключение через `.pgpass` и откат restore при ошибке зависимости.
- `./scripts/check-helm.sh`: strict lint и template встроенной/внешней БД, backup off, S3 on и существующих Secret/PVC.
- CI job `docker` запускает `./scripts/compose-smoke.sh`: создаёт администратора и финансовые записи, делает бэкап,
  удаляет схемы `public`/`drizzle`, восстанавливает, запускает приложение с миграциями и проверяет администратора, хеш пароля,
  сумму/дату операции и связи со счётом/категорией. Используются отдельный Compose project, каталог и порт 3330.

Держите минимум **3 копии**, на **2 независимых носителях**, **1 вне основного сервера**. RAID, реплики PVC и бэкап на том же диске
не защищают от потери сервера. Сохраните `.env`/Secret и ключ шифрования отдельно от БД. Периодически восстанавливайте копию
на отдельном сервере/БД, проверяйте вход и данные, записывайте дату проверки. Перед обновлением приложения создавайте ручную копию.

Технические справочники: [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html),
[CronJob и timeZone](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/),
[официальный контейнер AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-docker.html).
