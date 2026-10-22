// Convert the app's connection URI into libpq files without exposing credentials in argv.
import { mkdirSync, writeFileSync } from "node:fs"

try {
  const url = new URL(process.env.DATABASE_URL)
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error()
  const options = new Map([
    ["host", url.hostname.replace(/^\[|\]$/g, "")],
    ["port", url.port || "5432"],
    ["user", decodeURIComponent(url.username)],
    ["dbname", decodeURIComponent(url.pathname.slice(1))],
  ])
  let password = decodeURIComponent(url.password)
  for (const [key, value] of url.searchParams) {
    if (key === "password") password = value
    else if (/^[a-z_]+$/.test(key) && !["service", "servicefile", "passfile"].includes(key)) options.set(key, value)
    else throw new Error()
  }
  // Service files cannot represent multiline values or preserve surrounding whitespace.
  for (const value of options.values()) {
    if (/[\r\n\0]/.test(value) || value.trim() !== value) throw new Error()
  }
  if (/[\r\n\0]/.test(password)) throw new Error()
  const dir = process.env.CONNECTION_DIR || "/work/connection"
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const passfile = `${dir}/pgpass`
  writeFileSync(passfile, `*:*:*:*:${password.replace(/[\\:]/g, "\\$&")}\n`, { mode: 0o600 })
  writeFileSync(`${dir}/pg_service.conf`, `[bestbudget]\n${[...options].map(([key, value]) => `${key}=${value}`).join("\n")}\npassfile=${passfile}\n`, { mode: 0o600 })
} catch {
  console.error("Cannot prepare database connection; check DATABASE_URL format and writable connection directory.")
  process.exitCode = 1
}
