import { createHash, randomUUID } from "node:crypto"
import { constants, createReadStream } from "node:fs"
import { access, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { BackupError } from "./config"
import { backupTimestamp, type BackupFile } from "./policy"

export async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.partial`
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" })
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")) as T } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw new BackupError("Could not read backup status. Check .status.json/.schedule.json files")
  }
}

export async function regularFile(file: string) {
  try { return (await lstat(file)).isFile() } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

export async function listBackups(dir: string): Promise<BackupFile[]> {
  let names: string[]
  try { names = await readdir(dir) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
  const files: BackupFile[] = []
  for (const name of names) {
    const createdAt = backupTimestamp(name)
    if (!createdAt || !await regularFile(path.join(dir, name)) || !await regularFile(path.join(dir, `${name}.sha256`))) continue
    files.push({ name, createdAt, size: (await lstat(path.join(dir, name))).size })
  }
  return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name))
}

export async function sha256(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

export function restoreName(input: string, dir: string) {
  const name = path.basename(input)
  if (!backupTimestamp(name) || (input !== name && input !== `backups/${name}` && path.resolve(input) !== path.join(dir, name))) {
    throw new BackupError("Specify a dump filename or backups/<name>.dump from the backup directory")
  }
  return name
}

export async function verifyChecksum(dir: string, name: string) {
  if (!backupTimestamp(name) || !await regularFile(path.join(dir, name)) || !await regularFile(path.join(dir, `${name}.sha256`))) {
    throw new BackupError("Both the dump and .sha256 files are required; symlinks are not supported")
  }
  if (await readFile(path.join(dir, `${name}.sha256`), "utf8") !== `${await sha256(path.join(dir, name))}  ${name}\n`) {
    throw new BackupError("SHA-256 mismatch: restore cancelled")
  }
}

export async function writableDirectory(dir: string) {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await access(dir, constants.W_OK)
  } catch { throw new BackupError("Cannot access the backup directory. Create ./backups and check LOCAL_UID/LOCAL_GID") }
}
