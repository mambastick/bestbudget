import { EventEmitter } from "node:events"
import { spawn } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { expect, it, vi } from "vitest"
import { withPgTools } from "./database"

vi.mock("node:child_process", () => ({ spawn: vi.fn(() => {
  const child = new EventEmitter()
  queueMicrotask(() => child.emit("exit", 0))
  return child
}) }))

it("passes URI credentials through private libpq files, preserves TLS and removes temporary files", async () => {
  let serviceFile = ""
  await withPgTools("postgres://budget:p%3Aa%5Css%20word@[::1]:5433/family?sslmode=require", async (command) => {
    await command("pg_dump", ["--format=custom"])
    const call = vi.mocked(spawn).mock.calls[0]!
    expect(call[1]).toEqual(["--format=custom"])
    const env = call[2]!.env!
    serviceFile = env.PGSERVICEFILE!
    const service = await readFile(serviceFile, "utf8")
    expect(service).toContain("host=::1\nport=5433\nuser=budget\ndbname=family\nsslmode=require\n")
    const passfile = service.split("passfile=")[1]!.trim()
    expect(await readFile(passfile, "utf8")).toBe("*:*:*:*:p\\:a\\\\ss word\n")
    expect((await stat(passfile)).mode & 0o777).toBe(0o600)
    expect(env.PGPASSWORD).toBeUndefined()
    expect(JSON.stringify(call[1])).not.toContain("p:a")
  })
  await expect(stat(serviceFile)).rejects.toMatchObject({ code: "ENOENT" })
})
