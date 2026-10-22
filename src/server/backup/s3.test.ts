import { createServer, type Server } from "node:http"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { backupConfig } from "./config"
import { sha256 } from "./files"
import { uploadBackups } from "./s3"

let server: Server
let dir: string
let endpoint: string
let fail = false
const requests: { url: string; body: Buffer; authorization: string }[] = []
const name = "bestbudget-20261023T030000Z-v1.0.0-beta.1.dump"
beforeEach(async () => {
  vi.stubEnv("AWS_ACCESS_KEY_ID", "fixture-key")
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "fixture-secret")
  dir = await mkdtemp(path.join(tmpdir(), "backup-s3-test-"))
  requests.length = 0
  fail = false
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({ url: request.url!, body: Buffer.concat(chunks), authorization: request.headers.authorization ?? "" })
    response.writeHead(fail ? 403 : 200)
    response.end(fail ? "<Error><Code>AccessDenied</Code></Error>" : "")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as { port: number }
  endpoint = `http://127.0.0.1:${address.port}`
  await writeFile(path.join(dir, name), Buffer.from([0, 1, 2, 255]))
  await writeFile(path.join(dir, `${name}.sha256`), `${await sha256(path.join(dir, name))}  ${name}\n`)
})
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

it("uses signed path-style requests for custom S3 endpoints and publishes checksum last", async () => {
  const config = backupConfig({ ...process.env, BACKUP_DIR: dir, BACKUP_S3_BUCKET: "family", BACKUP_S3_ENDPOINT: endpoint, BACKUP_S3_REGION: "ru-central1" })
  await uploadBackups(config)
  expect(requests.map((request) => request.url.split("?")[0])).toEqual([`/family/bestbudget/${name}`, `/family/bestbudget/${name}.sha256`])
  expect(requests[0]!.body).toEqual(await readFile(path.join(dir, name)))
  expect(requests[1]!.body).toEqual(await readFile(path.join(dir, `${name}.sha256`)))
  expect(requests[0]!.authorization).toContain("/ru-central1/s3/aws4_request")
  await uploadBackups(config)
  expect(requests).toHaveLength(2)
  await uploadBackups({ ...config, BACKUP_S3_BUCKET: "another" })
  expect(requests).toHaveLength(4)
})

it("keeps local data on S3 failure and retries without leaking credentials", async () => {
  const config = backupConfig({ ...process.env, BACKUP_DIR: dir, BACKUP_S3_BUCKET: "family", BACKUP_S3_ENDPOINT: endpoint })
  fail = true
  await expect(uploadBackups(config)).rejects.toThrow("локальная копия сохранена")
  expect(await readFile(path.join(dir, name))).toHaveLength(4)
  fail = false
  await uploadBackups(config)
  expect(requests.at(-1)!.url).toContain(".sha256")
})
