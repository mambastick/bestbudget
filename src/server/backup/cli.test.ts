import { execFile, spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { backupConfig } from "./config"

const exec = promisify(execFile)
const args = ["--import", "tsx", "scripts/backup.ts"]
let dir: string
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "backup-cli-test-")) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

function env(enabled = "false") {
  return {
    NODE_ENV: "test" as const,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    BACKUP_ENABLED: enabled,
    BACKUP_DIR: dir,
    TZ: "UTC",
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused?connect_timeout=1",
  }
}

describe("backup opt-out", () => {
  it("keeps CLI output and usage errors in English regardless of the process language", async () => {
    const settings = { ...env("true"), LANG: "ru_RU.UTF-8" }
    expect((await exec(process.execPath, [...args, "list"], { env: settings })).stdout).toBe("No backups yet\n")
    const { stdout } = await exec(process.execPath, [...args, "status"], { env: settings })
    expect(stdout).toContain("No successful backups yet\nNext run: unavailable (UTC)\nS3: disabled\n")
    await expect(exec(process.execPath, [...args, "verify"], { env: settings })).rejects.toMatchObject({
      code: 1, stderr: "Specify a file: verify backups/<name>.dump\n",
    })
  })

  it("defaults to enabled and parses false without boolean coercion", () => {
    expect(backupConfig({ NODE_ENV: "test" }).BACKUP_ENABLED).toBe(true)
    expect(backupConfig({ NODE_ENV: "test", BACKUP_ENABLED: "true" }).BACKUP_ENABLED).toBe(true)
    expect(backupConfig({ NODE_ENV: "test", BACKUP_ENABLED: "false" }).BACKUP_ENABLED).toBe(false)
    expect(() => backupConfig({ NODE_ENV: "test", BACKUP_ENABLED: "invalid" })).toThrow("BACKUP_ENABLED")
  })

  it.each(["SIGTERM", "SIGINT"] as const)("idles without catch-up or file writes and exits on %s", async (signal) => {
    const state = '{"firstDue":"2000-01-01T00:00:00Z","nextRun":"2000-01-01T00:00:00Z"}'
    await writeFile(path.join(dir, ".schedule.json"), state)
    const child = spawn(process.execPath, [...args, "schedule"], { env: env(), stdio: ["ignore", "pipe", "pipe"] })
    const exited = once(child, "exit")
    let stdout = "", stderr = ""
    child.stdout.on("data", (data) => { stdout += String(data) })
    child.stderr.on("data", (data) => { stderr += String(data) })
    try {
      await vi.waitFor(() => expect(stdout).toBe("backups disabled (BACKUP_ENABLED=false)\n"), { timeout: 10_000 })
      expect(child.exitCode).toBeNull()
      child.kill(signal)
      expect(await exited).toEqual([0, null])
      expect(stdout).toBe("backups disabled (BACKUP_ENABLED=false)\n")
      expect(stderr).toBe("")
      expect(await readdir(dir)).toEqual([".schedule.json"])
      expect(await readFile(path.join(dir, ".schedule.json"), "utf8")).toBe(state)
    } finally {
      if (child.exitCode === null) { child.kill("SIGKILL"); await exited }
    }
  })

  it("reports healthy without a backup directory or DB, while enabled mode stays unhealthy", async () => {
    const settings = { ...env(), BACKUP_DIR: path.join(dir, "missing") }
    const { stdout } = await exec(process.execPath, [...args, "status", "--json", "--health"], { env: settings })
    expect(JSON.parse(stdout)).toMatchObject({ enabled: false, healthy: true, nextRun: null, s3: { status: "disabled" } })
    await expect(exec(process.execPath, [...args, "status", "--health"], { env: { ...settings, BACKUP_ENABLED: "true" } })).rejects.toMatchObject({ code: 1 })
    expect(await readdir(dir)).toEqual([])
  })

  it("keeps manual list and restore validation active when disabled", async () => {
    const name = "bestbudget-20261023T030000Z-v1.0.0-beta.2.dump"
    await writeFile(path.join(dir, name), "fixture archive")
    await writeFile(path.join(dir, `${name}.sha256`), "fixture checksum")
    const { stdout } = await exec(process.execPath, [...args, "list", "--json"], { env: env() })
    expect(JSON.parse(stdout)).toMatchObject([{ name }])
    await expect(exec(process.execPath, [...args, "restore", `backups/${name}`], { env: env() })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("--yes") })
  })
})
