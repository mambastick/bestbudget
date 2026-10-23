import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { BackupError, type BackupConfig } from "./config"
import { listBackups, regularFile, verifyChecksum } from "./files"

export function s3Client(config: BackupConfig) {
  return new S3Client({
    region: config.BACKUP_S3_REGION,
    endpoint: config.BACKUP_S3_ENDPOINT,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
  })
}

export async function uploadBackups(config: BackupConfig) {
  const client = s3Client(config)
  try {
    for (const file of await listBackups(config.BACKUP_DIR)) {
      const prefix = config.BACKUP_S3_PREFIX.replace(/^\/+|\/+$/g, "")
      const key = `${prefix ? `${prefix}/` : ""}${file.name}`
      const destination = createHash("sha256").update(JSON.stringify([config.BACKUP_S3_ENDPOINT, config.BACKUP_S3_BUCKET, key])).digest("hex")
      const receipt = path.join(config.BACKUP_DIR, `${file.name}.uploaded`)
      if (await regularFile(receipt) && await readFile(receipt, "utf8") === destination) continue
      await verifyChecksum(config.BACKUP_DIR, file.name)
      await client.send(new PutObjectCommand({ Bucket: config.BACKUP_S3_BUCKET, Key: key, Body: createReadStream(path.join(config.BACKUP_DIR, file.name)), ContentLength: file.size }), { abortSignal: AbortSignal.timeout(15 * 60_000) })
      const checksum = await readFile(path.join(config.BACKUP_DIR, `${file.name}.sha256`))
      await client.send(new PutObjectCommand({ Bucket: config.BACKUP_S3_BUCKET, Key: `${key}.sha256`, Body: checksum, ContentLength: checksum.length }), { abortSignal: AbortSignal.timeout(15 * 60_000) })
      await writeFile(receipt, destination, { mode: 0o600 })
    }
  } catch {
    throw new BackupError("S3 upload failed; the local copy was preserved. Check the endpoint, bucket and access keys")
  } finally { client.destroy() }
}
