# Бэкапы BestBudget

## Нужно ли вам это

Бэкап БД — ответственность администратора, который установил приложение. Встроенные бэкапы — удобство для тех,
у кого нет своих, например семьи с Docker на NAS. Если вы уже бэкапите PostgreSQL (снапшоты, pgBackRest, Velero,
CloudNativePG или managed БД), выключите автоматические дампы: `BACKUP_ENABLED=false` в Compose или
`backup.enabled=false` в Helm. В Compose они включены по умолчанию, в Helm — выключены.

В Compose после изменения `.env` выполните `docker compose up -d --wait`: сервис `backup` выведет одну строку
`backups disabled (BACKUP_ENABLED=false)` и будет спать, healthcheck останется healthy. Ручные `backup now`,
`backup list` и `backup restore` продолжат работать: это осознанное действие администратора. Переменная вместо
Compose profiles сохраняет одинаковые команды запуска и ручного восстановления в обоих режимах.

Логический дамп полезен и при инфраструктурных бэкапах: его удобно перенести на другой сервер, версия приложения
есть в имени файла, а восстановление учитывает миграции — после restore они выполняются при запуске приложения.
Используйте ту же или более новую версию. Перед переносом или обновлением можно вручную выполнить `backup now`.

## Быстрый старт

Достаточно `compose.yaml`, заполненного `.env` и готового образа приложения. Бэкапы включены по умолчанию:
каждую ночь в **03:00 по `TZ`** (пример `.env` — `Europe/Moscow`), файлы видны в `./backups`.

```bash
mkdir -p backups
docker compose up -d --wait
docker compose run --rm backup now
docker compose run --rm backup list
docker compose run --rm backup status
```

Контейнеры работают без root, UID/GID по умолчанию `1000:1000`; если ваш обычный Linux-пользователь другой, укажите в `.env` `LOCAL_UID=$(id -u)` / `LOCAL_GID=$(id -g)` **числами** (не UID 0), и создайте `backups` от своего пользователя до первого запуска. При установке от root один раз выполните `chown 1000:1000 backups`.

Копия — сжатый файл `.dump` PostgreSQL 17 и соседний `.dump.sha256`. Имена содержат UTC-время и версию приложения.
Незавершённые копии не показываются в списке. По умолчанию сохраняются **последние 7 плюс все за последние 30 дней**.

## Настройки

После изменения `.env` выполните `docker compose up -d --wait`.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `BACKUP_ENABLED` | `true` | `false` выключает автоматические дампы; healthcheck проходит, ручные команды доступны |
| `BACKUP_TIME` | `03:00` | Ежедневное время `HH:MM` в часовом поясе `TZ` |
| `TZ` | `Europe/Moscow` в Compose | Часовой пояс, например `Europe/Moscow` или `Asia/Yekaterinburg` |
| `BACKUP_PATH` | `./backups` | Каталог на хосте; можно указать отдельный диск |
| `BACKUP_KEEP_LAST` | `7` | Минимальное число последних копий, не меньше 1 |
| `BACKUP_KEEP_DAYS` | `30` | Дополнительно сохранять все копии за N дней; `0` — только последние N |
| `LOCAL_UID`, `LOCAL_GID` | `1000`, `1000` | UID/GID владельца файлов на Linux |
| `BACKUP_S3_BUCKET` | пусто | Непустое значение включает выгрузку S3 |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | пусто | Ключи S3; также поддерживаются IAM и `AWS_SESSION_TOKEN` |
| `BACKUP_S3_ENDPOINT` | AWS S3 | Endpoint Yandex Object Storage, MinIO и других совместимых сервисов |
| `BACKUP_S3_REGION` | `us-east-1` | Регион вашего хранилища |
| `BACKUP_S3_PREFIX` | `bestbudget` | Каталог внутри бакета |

При переходе на летнее время несуществующее локальное время пропускается; при повторе часа бэкап запускается один раз за локальный день.

## Восстановление

Сохраните `.env` и прежние `BETTER_AUTH_SECRET`/`ENCRYPTION_KEY`: они нужны для восстановления зашифрованных настроек SSO.
Положите доверенный дамп **вместе с `.sha256`** в `./backups`. Подставьте его имя:

```bash
docker compose stop app && docker compose run --rm backup restore backups/bestbudget-20261023T000000Z-v1.0.0-beta.1-12345678.dump --yes && docker compose start app
```

Команда проверит SHA-256 и формат архива, откажется при открытых подключениях к БД, автоматически сохранит текущую БД
в файл с `before-restore` в имени и только затем восстановит выбранную копию. Если страховочный дамп не удался, данные не меняются.
При ошибке восстановления изменения откатываются, приложение остаётся остановленным. Миграции выполняются при его запуске.

На новом сервере сначала запустите `docker compose up -d --wait db`, затем используйте ту же команду восстановления.
Предпочтительна пустая целевая БД: объекты, которых нет в дампе, restore не удаляет. Используйте ту же или более новую версию приложения.

## S3

Для AWS S3 достаточно трёх значений в `.env`:

```dotenv
BACKUP_S3_BUCKET=family-backups
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Для Yandex Object Storage добавьте `BACKUP_S3_ENDPOINT=https://storage.yandexcloud.net` и `BACKUP_S3_REGION=ru-central1`.
Для MinIO задайте доступный контейнеру endpoint, например `https://minio.example.com`, и регион своего сервера.
Бакет создайте заранее. Сервисов и профилей добавлять не нужно: тот же процесс после бэкапа отправит дамп, затем checksum.

Ошибка выгрузки видна в логах и `backup status`; локальная копия сохраняется. Следующий `backup now` или ночной запуск повторит
отправку ожидающих копий. Локальная ротация действует и на неотправленные копии, поэтому длительный сбой S3 требует внимания.
Срок хранения удалённых объектов задаётся lifecycle-правилами бакета; локальная ротация их не удаляет.

Для восстановления скачайте оба файла с сохранением имён в `./backups` и используйте обычную команду restore.
Ключи не сохраняйте в Git; для бакета включите шифрование и ограничьте доступ. Один дамп для выгрузки — до 5 ГиБ.

## Kubernetes

В Helm встроенные бэкапы выключены по умолчанию: backup-CronJob и backup-PVC не создаются.
**При обновлении задайте `backup.enabled=true` явно, если пользуетесь встроенными бэкапами.**
Сгенерированный backup-PVC сохраняется и при выключении бэкапов; для повторного использования задайте `backup.persistence.existingClaim`.

Для включения нужен Kubernetes 1.27+. CronJob использует тот же образ приложения и тот же Secret БД. Скрипты и дополнительные образы не нужны.

```yaml
backup:
  enabled: true
  schedule: "0 3 * * *"
  timeZone: Europe/Moscow
  retention:
    keepLast: 7
    keepDays: 30
  persistence:
    size: 5Gi
    storageClass: ""
    existingClaim: ""
```

При S3 задайте `backup.s3.enabled`, `bucket`, `endpoint`, `region`, `prefix` и `existingSecret`.
Secret содержит `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, опционально `AWS_SESSION_TOKEN`.
Backup-PVC сохраняется при удалении релиза; для повторного использования укажите его как `existingClaim`.

Ручной бэкап (пример: namespace/release `bestbudget`):

```bash
kubectl -n bestbudget create job --from=cronjob/bestbudget-backup bestbudget-manual
kubectl -n bestbudget logs -f job/bestbudget-manual
```

Для восстановления остановите приложение и приостановите расписание; дождитесь завершения уже работающих Job.
Сохраните исходное число реплик. Укажите имя файла из backup-PVC; команда требует `jq`:

```bash
kubectl -n bestbudget patch cronjob bestbudget-backup --type=merge -p '{"spec":{"suspend":true}}'
kubectl -n bestbudget scale deployment bestbudget --replicas=0
# После остановки pod приложения и завершения backup Job:
kubectl -n bestbudget create job bestbudget-restore --from=cronjob/bestbudget-backup --dry-run=client -o json \
  | jq '.spec.backoffLimit=0 | .spec.template.spec.containers[0].args=["backup","restore","backups/ИМЯ-ФАЙЛА.dump","--yes"]' \
  | kubectl -n bestbudget create -f -
kubectl -n bestbudget wait --for=condition=complete job/bestbudget-restore --timeout=3600s
kubectl -n bestbudget logs job/bestbudget-restore
```

После успешного restore верните прежнее число реплик и `suspend=false` (если расписание было включено).
Для списка или проверки файла используйте тот же Job, заменив аргументы на `["backup","list"]` или `["backup","verify","backups/ИМЯ-ФАЙЛА.dump"]`.
На новом кластере сначала перенесите пару файлов на backup-PVC через временный pod и `kubectl cp`; приложение до restore не запускайте.

## Проверка бэкапов

```bash
docker compose run --rm backup verify backups/ИМЯ-ФАЙЛА.dump
docker compose run --rm backup status
docker compose logs --tail=50 backup
```

При `BACKUP_ENABLED=false` статус сообщает об отключении расписания и возвращает healthy без проверки файлов и S3.
При включённом расписании статус показывает время и размер последней копии, следующий запуск и состояние S3. Контейнер становится `unhealthy`, если успешная
копия старше 26 часов. При первом запуске до первого запланированного окна отсутствие копий допустимо; перезапуск не продлевает эту отсрочку.
S3-сбой не делает свежий локальный бэкап неуспешным: проверяйте также S3-строку статуса. В Kubernetes следите за результатами CronJob.

Проверка SHA-256 не заменяет пробное восстановление. Периодически восстанавливайте копию в отдельную БД и проверяйте вход, счета и операции.
CI выполняет цикл «копия → удаление схем → восстановление → данные на месте» из каталога с одним Compose и `.env`.
Держите **3 копии на 2 независимых носителях, одну вне сервера**; RAID/PVC и копия на том же диске не защищают от потери сервера.

## FAQ / устранение проблем

- **Нет доступа к каталогу:** создайте `backups` от своего Linux-пользователя до запуска; UID/GID контейнеров должны совпадать с владельцем.
  Если Docker уже создал пустой каталог от root, один раз измените владельца через `sudo chown <uid>:<gid> backups`.
- **Restore сообщает о подключениях:** остановите `app`, сторонние клиенты и дождитесь окончания текущего бэкапа. Не завершайте чужие подключения принудительно.
- **S3 error:** проверьте bucket, endpoint, регион и ключи; локальные копии остаются доступны. После исправления запустите `backup now`.
- **Unhealthy:** проверьте место на диске, доступ к БД и логи, затем выполните `backup now`.
- **Сервер аварийно выключился:** незавершённые `.incomplete-*` не учитываются; после проверки отсутствия активных операций их можно удалить.
- **Внешняя БД:** клиент PostgreSQL 17 рассчитан на сервер версии 17 или старше; для более новой major нужен образ с соответствующим клиентом.
