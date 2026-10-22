import path from "node:path"
import { z } from "zod"

export class BackupError extends Error {}

const schema = z.object({
  BACKUP_DIR: z.string().default("/app/backups"),
  BACKUP_TIME: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("03:00"),
  BACKUP_KEEP_LAST: z.coerce.number().int().min(1).max(100000).default(7),
  BACKUP_KEEP_DAYS: z.coerce.number().int().min(0).max(36500).default(30),
  TZ: z.string().default(Intl.DateTimeFormat().resolvedOptions().timeZone),
  BESTBUDGET_VERSION: z.string().default(""),
  DATABASE_URL: z.string().optional(),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_PREFIX: z.string().default("bestbudget"),
  BACKUP_S3_ENDPOINT: z.url().optional(),
  BACKUP_S3_REGION: z.string().default("us-east-1"),
})

export function backupConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, value]) => value !== "")))
  if (!parsed.success) throw new BackupError(`Проверьте настройки: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`)
  try { new Intl.DateTimeFormat("en", { timeZone: parsed.data.TZ }).format() } catch { throw new BackupError("Некорректный часовой пояс TZ") }
  return { ...parsed.data, BACKUP_DIR: path.resolve(parsed.data.BACKUP_DIR) }
}
export type BackupConfig = ReturnType<typeof backupConfig>
