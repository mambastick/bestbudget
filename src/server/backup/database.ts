import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import postgres from "postgres"
import { BackupError, type BackupConfig } from "./config"

export type PgCommand = (tool: "pg_dump" | "pg_restore", args: string[]) => Promise<void>

/** libpq files preserve URI options without exposing credentials in child-process argv. */
export async function withPgTools<T>(url: string, operation: (command: PgCommand) => Promise<T>): Promise<T> {
  const temporary = await mkdtemp(path.join(tmpdir(), "bestbudget-pg-"))
  try {
    const parsed = new URL(url)
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) throw new BackupError("DATABASE_URL must be a PostgreSQL URI")
    const options = new Map([
      ["host", parsed.hostname.replace(/^\[|\]$/g, "")], ["port", parsed.port || "5432"],
      ["user", decodeURIComponent(parsed.username)], ["dbname", decodeURIComponent(parsed.pathname.slice(1))],
    ])
    let password = decodeURIComponent(parsed.password)
    for (const [key, value] of parsed.searchParams) {
      if (key === "password") password = value
      else if (/^[a-z_]+$/.test(key) && !["service", "servicefile", "passfile"].includes(key)) options.set(key, value)
      else throw new BackupError("Unsupported DATABASE_URL parameter")
    }
    if ([...options.values()].some((value) => /[\r\n\0]/.test(value) || value.trim() !== value) || /[\r\n\0]/.test(password)) {
      throw new BackupError("Unsupported characters in DATABASE_URL")
    }
    const passfile = path.join(temporary, "pgpass")
    await writeFile(passfile, `*:*:*:*:${password.replace(/[\\:]/g, "\\$&")}\n`, { mode: 0o600 })
    const servicefile = path.join(temporary, "pg_service.conf")
    await writeFile(servicefile, `[backup]\n${[...options].map(([key, value]) => `${key}=${value}`).join("\n")}\npassfile=${passfile}\n`, { mode: 0o600 })
    // Drop inherited libpq defaults so every tool uses exactly this database.
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const key of Object.keys(env)) if (key.startsWith("PG")) delete env[key]
    Object.assign(env, { PGSERVICE: "backup", PGSERVICEFILE: servicefile, PGCONNECT_TIMEOUT: "15" })
    return await operation((tool, args) => new Promise<void>((resolve, reject) => {
      const child = spawn(tool, args, { env, stdio: "ignore" })
      child.once("error", () => reject(new BackupError(`${tool} is unavailable in the image`)))
      child.once("exit", (code) => code === 0 ? resolve() : reject(new BackupError(`${tool}: operation failed. Check database access, permissions and PostgreSQL version`)))
    }))
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

export async function withDatabase<T>(config: BackupConfig, operation: (sql: ReturnType<typeof postgres>, command: PgCommand) => Promise<T>) {
  if (!config.DATABASE_URL) throw new BackupError("DATABASE_URL is not set")
  const sql = postgres(config.DATABASE_URL, { max: 1, connect_timeout: 15, idle_timeout: 0, onnotice: () => {} })
  try {
    const [lock] = await sql<{ locked: boolean }[]>`select pg_try_advisory_lock(174903113, 481516) as locked`
    if (!lock?.locked) throw new BackupError("Another backup or restore operation is running. Try again later")
    return await withPgTools(config.DATABASE_URL, (command) => operation(sql, command))
  } catch (error) {
    if (error instanceof BackupError) throw error
    throw new BackupError("Database operation failed. Check DATABASE_URL and PostgreSQL availability")
  } finally { await sql.end({ timeout: 5 }) }
}
