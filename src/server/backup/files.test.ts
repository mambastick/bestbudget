import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { atomicJson, listBackups, restoreName, sha256, verifyChecksum } from "./files"

let dir: string
const name = "bestbudget-20261023T030000Z-v1.0.0-beta.1.dump"
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "backup-files-test-")) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

async function fixture() {
  await writeFile(path.join(dir, name), "fixture archive")
  await writeFile(path.join(dir, `${name}.sha256`), `${await sha256(path.join(dir, name))}  ${name}\n`)
}

describe("published backup files", () => {
  it("lists only complete regular pairs and rejects partial dumps and symlinks", async () => {
    await fixture()
    await writeFile(path.join(dir, "bestbudget-20261024T030000Z.dump"), "partial")
    await symlink(path.join(dir, name), path.join(dir, "bestbudget-20261025T030000Z.dump"))
    await writeFile(path.join(dir, "bestbudget-20261025T030000Z.dump.sha256"), "anything")
    await writeFile(path.join(dir, "notes.dump"), "owner data")
    expect((await listBackups(dir)).map((file) => file.name)).toEqual([name])
    await expect(verifyChecksum(dir, "bestbudget-20261025T030000Z.dump")).rejects.toThrow("символические")
  })
  it("detects changed data and checksum path injection", async () => {
    await fixture()
    await expect(verifyChecksum(dir, name)).resolves.toBeUndefined()
    await writeFile(path.join(dir, `${name}.sha256`), `${await sha256(path.join(dir, name))}  ../../private\n`)
    await expect(verifyChecksum(dir, name)).rejects.toThrow("SHA-256")
    await fixture()
    await writeFile(path.join(dir, name), "corrupted")
    await expect(verifyChecksum(dir, name)).rejects.toThrow("SHA-256")
  })
  it("accepts the documented restore path and rejects files outside the mount", () => {
    expect(restoreName(`backups/${name}`, dir)).toBe(name)
    expect(() => restoreName(`../${name}`, dir)).toThrow("каталога")
  })
  it("replaces status files atomically", async () => {
    const file = path.join(dir, ".status.json")
    await atomicJson(file, { status: "error" })
    await atomicJson(file, { status: "ok" })
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ status: "ok" })
  })
})

it("reports real file size and persists the first-window health deadline", async () => {
  const { backupConfig } = await import("./config")
  const { BackupService } = await import("./service")
  const service = new BackupService(backupConfig({ ...process.env, BACKUP_DIR: dir, TZ: "Europe/Moscow" }))
  await atomicJson(path.join(dir, ".schedule.json"), { firstDue: "2026-10-23T00:00:00Z", nextRun: "2026-10-24T00:00:00Z" })
  expect((await service.status(new Date("2026-10-22T23:59:00Z"))).healthy).toBe(true)
  expect((await service.status(new Date("2026-10-23T00:01:00Z"))).healthy).toBe(false)
  await fixture()
  expect(await service.status(new Date("2026-10-23T05:00:00Z"))).toMatchObject({ healthy: true, lastSuccess: { name, size: 15 }, nextRun: "2026-10-24T00:00:00Z" })
  expect((await service.status(new Date("2026-10-24T05:00:00Z"))).healthy).toBe(false)
})
