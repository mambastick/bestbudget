const filenamePattern = /^bestbudget-(\d{8}T\d{6}Z)(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?\.dump$/

export interface BackupFile {
  name: string
  createdAt: string
  size: number
}

export function backupTimestamp(name: string): string | null {
  if (/[^A-Za-z0-9._-]/.test(name)) return null
  const stamp = filenamePattern.exec(name)?.[1]
  if (!stamp) return null
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) && date.toISOString().replace(/[-:]/g, "").replace(".000", "") === stamp ? date.toISOString() : null
}

/** Keep the union of count and age retention; never delete a protected restore source. */
export function expiredBackups(files: BackupFile[], keepLast: number, keepDays: number, now: Date, protectedNames: string[] = []) {
  const sorted = files.filter((file) => backupTimestamp(file.name)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name))
  const cutoff = now.getTime() - keepDays * 86_400_000
  return sorted.filter((file, index) => index >= keepLast && Date.parse(file.createdAt) < cutoff && !protectedNames.includes(file.name))
}

export function localDay(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}

/** Search real instants: DST gaps are skipped and a repeated local day runs only once. */
export function nextDailyRun(after: Date, time: string, timeZone: string, lastDay?: string): Date {
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000
  for (let instant = start; instant < start + 3 * 86_400_000; instant += 60_000) {
    const date = new Date(instant)
    if (clock.format(date) === time && (!lastDay || localDay(date, timeZone) !== lastDay)) return date
  }
  throw new Error("Cannot compute backup schedule")
}

export function backupHealthy(last: BackupFile | undefined, firstDue: string | undefined, now: Date) {
  if (last) return now.getTime() - Date.parse(last.createdAt) < 26 * 3_600_000
  return Boolean(firstDue && now.getTime() < Date.parse(firstDue))
}
