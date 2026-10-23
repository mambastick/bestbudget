import { setTimeout } from "node:timers/promises"
import path from "node:path"
import { BackupError, backupConfig } from "../../src/server/backup/config"
import { atomicJson, listBackups, readJson, writableDirectory } from "../../src/server/backup/files"
import { localDay, nextDailyRun } from "../../src/server/backup/policy"
import { BackupService, type ScheduleState } from "../../src/server/backup/service"

process.umask(0o077)

function displayTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}
async function schedule(config: ReturnType<typeof backupConfig>, service: BackupService) {
  if (!config.BACKUP_ENABLED) {
    const controller = new AbortController()
    for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => controller.abort())
    console.log("backups disabled (BACKUP_ENABLED=false)")
    while (!controller.signal.aborted) await setTimeout(30_000, undefined, { signal: controller.signal }).catch(() => {})
    return
  }
  await writableDirectory(config.BACKUP_DIR)
  const file = path.join(config.BACKUP_DIR, ".schedule.json")
  const previous = await readJson<ScheduleState>(file)
  const next = nextDailyRun(new Date(), config.BACKUP_TIME, config.TZ, previous?.lastDay).toISOString()
  const state: ScheduleState = { ...previous, firstDue: previous?.firstDue ?? next, nextRun: next }
  // Catch up the missed first window after a restart instead of granting a new grace period.
  const latest = (await listBackups(config.BACKUP_DIR))[0]
  if ((!latest && Date.parse(state.firstDue) <= Date.now()) || (latest && Date.now() - Date.parse(latest.createdAt) >= 26 * 3_600_000)) state.nextRun = new Date().toISOString()
  await atomicJson(file, state)
  const controller = new AbortController()
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => controller.abort())
  console.log(`Бэкапы ежедневно в ${config.BACKUP_TIME} (${config.TZ}); следующий: ${displayTime(state.nextRun, config.TZ)}`)
  while (!controller.signal.aborted) {
    if (Date.now() >= Date.parse(state.nextRun)) {
      try { await service.now() } catch (error) { console.error(error instanceof BackupError ? error.message : "Не удалось создать бэкап") }
      state.lastDay = localDay(new Date(), config.TZ)
      state.nextRun = nextDailyRun(new Date(), config.BACKUP_TIME, config.TZ, state.lastDay).toISOString()
      await atomicJson(file, state)
    }
    await setTimeout(30_000, undefined, { signal: controller.signal }).catch(() => {})
  }
}

async function main() {
  const config = backupConfig()
  const service = new BackupService(config)
  const [command = "status", input] = process.argv.slice(2)
  const json = process.argv.includes("--json")
  switch (command) {
    case "now": await service.now(); break
    case "list": {
      const files = await listBackups(config.BACKUP_DIR)
      if (json) console.log(JSON.stringify(files))
      else if (!files.length) console.log("Бэкапов пока нет")
      else for (const file of files) console.log(`${file.name}\t${file.size} байт\t${file.createdAt}`)
      break
    }
    case "verify":
      if (!input) throw new BackupError("Укажите файл: verify backups/<имя>.dump")
      console.log(`Проверено: ${await service.verify(input)}`)
      break
    case "restore":
      if (!input) throw new BackupError("Укажите файл: restore backups/<имя>.dump --yes")
      await service.restore(input, process.argv.includes("--yes"))
      break
    case "schedule": await schedule(config, service); break
    case "status": {
      const status = await service.status()
      if (json) console.log(JSON.stringify(status))
      else if (!status.enabled) console.log("backups disabled (BACKUP_ENABLED=false)")
      else {
        console.log(status.lastSuccess ? `Последний бэкап: ${displayTime(status.lastSuccess.createdAt, config.TZ)}, ${status.lastSuccess.size} байт (${status.lastSuccess.name})` : "Успешных бэкапов пока нет")
        console.log(`Следующий запуск: ${status.nextRun ? displayTime(status.nextRun, config.TZ) : "нет данных"} (${status.timeZone})`)
        const labels: Record<string, string> = { disabled: "выключено", pending: "ожидает выгрузки", ok: "успешно", error: "ошибка" }
        console.log(`S3: ${labels[status.s3.status] ?? status.s3.status}${status.error ? `; ${status.error}` : ""}`)
      }
      if (process.argv.includes("--health") && !status.healthy) process.exitCode = 1
      break
    }
    default: throw new BackupError("Команды: now | list | verify <файл> | restore <файл> --yes | schedule | status")
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof BackupError ? error.message : "Ошибка бэкапа. Проверьте настройки, права каталога и доступность БД")
  process.exitCode = 1
})
