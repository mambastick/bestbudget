import { randomUUID } from "node:crypto"
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { BackupError, type BackupConfig } from "./config"
import { withDatabase, withPgTools, type PgCommand } from "./database"
import { atomicJson, listBackups, readJson, restoreName, sha256, verifyChecksum, writableDirectory } from "./files"
import { backupHealthy, expiredBackups } from "./policy"
import { uploadBackups } from "./s3"

interface OperationState {
  error?: string
  s3?: { status: "ok" | "error"; at: string }
}
export interface ScheduleState { firstDue: string; nextRun: string; lastDay?: string }

export class BackupService {
  constructor(readonly config: BackupConfig) {}

  async verify(input: string, command?: PgCommand) {
    const name = restoreName(input, this.config.BACKUP_DIR)
    await verifyChecksum(this.config.BACKUP_DIR, name)
    const check = (run: PgCommand) => run("pg_restore", ["--list", path.join(this.config.BACKUP_DIR, name)])
    if (command) await check(command)
    else {
      // --list needs no connection, but uses the same protected process runner.
      await withPgTools("postgres://postgres@localhost/postgres", check)
    }
    return name
  }

  private async dump(command: PgCommand, safety = false) {
    await writableDirectory(this.config.BACKUP_DIR)
    const version = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(this.config.BESTBUDGET_VERSION) ? `-v${this.config.BESTBUDGET_VERSION}` : ""
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
    const name = `bestbudget-${stamp}${version}${safety ? "-before-restore" : ""}-${randomUUID().slice(0, 8)}.dump`
    const temporary = await mkdtemp(path.join(this.config.BACKUP_DIR, ".incomplete-"))
    try {
      await command("pg_dump", ["--no-password", "--format=custom", "--compress=6", "--no-owner", "--no-acl", `--file=${path.join(temporary, name)}`])
      await command("pg_restore", ["--list", path.join(temporary, name)])
      await writeFile(path.join(temporary, `${name}.sha256`), `${await sha256(path.join(temporary, name))}  ${name}\n`, { mode: 0o600 })
      await rename(path.join(temporary, name), path.join(this.config.BACKUP_DIR, name))
      await rename(path.join(temporary, `${name}.sha256`), path.join(this.config.BACKUP_DIR, `${name}.sha256`))
      return name
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }

  private async rotate(protectedNames: string[] = []) {
    const expired = expiredBackups(await listBackups(this.config.BACKUP_DIR), this.config.BACKUP_KEEP_LAST, this.config.BACKUP_KEEP_DAYS, new Date(), protectedNames)
    for (const file of expired) {
      for (const suffix of [".sha256", "", ".uploaded"]) await rm(path.join(this.config.BACKUP_DIR, `${file.name}${suffix}`), { force: true })
    }
  }

  private async upload() {
    if (!this.config.BACKUP_S3_BUCKET) return
    try {
      await uploadBackups(this.config)
      await atomicJson(path.join(this.config.BACKUP_DIR, ".status.json"), { s3: { status: "ok", at: new Date().toISOString() } })
    } catch (error) {
      await atomicJson(path.join(this.config.BACKUP_DIR, ".status.json"), { s3: { status: "error", at: new Date().toISOString() }, error: (error as BackupError).message })
      throw error
    }
  }

  async now() {
    return withDatabase(this.config, async (_sql, command) => {
      const name = await this.dump(command)
      await atomicJson(path.join(this.config.BACKUP_DIR, ".status.json"), {})
      await this.rotate()
      console.log(`Backup created: ${name}`)
      await this.upload()
      return name
    })
  }

  async restore(input: string, confirmed: boolean) {
    if (!confirmed) throw new BackupError("Restore replaces data. Add --yes and stop app first")
    return withDatabase(this.config, async (sql, command) => {
      const name = await this.verify(input, command)
      const [connections] = await sql<{ count: number }[]>`select count(*)::int as count from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and backend_type='client backend'`
      if (connections?.count) throw new BackupError("The database has active connections. Stop app and other clients, then retry restore")
      const safety = await this.dump(command, true)
      console.log(`Safety backup: ${safety}`)
      await command("pg_restore", ["--dbname=", "--no-password", "--clean", "--if-exists", "--no-owner", "--no-acl", "--single-transaction", path.join(this.config.BACKUP_DIR, name)])
      await this.rotate([name, safety])
      console.log(`Restored: ${name}`)
    })
  }

  async status(now = new Date()) {
    if (!this.config.BACKUP_ENABLED) return {
      enabled: false,
      lastSuccess: null,
      nextRun: null,
      timeZone: this.config.TZ,
      healthy: true,
      s3: { status: "disabled" },
      error: null,
    }
    const files = await listBackups(this.config.BACKUP_DIR)
    const schedule = await readJson<ScheduleState>(path.join(this.config.BACKUP_DIR, ".schedule.json"))
    const state = await readJson<OperationState>(path.join(this.config.BACKUP_DIR, ".status.json"))
    return {
      enabled: true,
      lastSuccess: files[0] ?? null,
      nextRun: schedule?.nextRun ?? null,
      timeZone: this.config.TZ,
      healthy: backupHealthy(files[0], schedule?.firstDue, now),
      s3: this.config.BACKUP_S3_BUCKET ? state?.s3 ?? { status: "pending" } : { status: "disabled" },
      error: state?.error ?? null,
    }
  }
}
