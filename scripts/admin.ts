/**
 * Administration and emergency-recovery CLI.
 *
 *   node dist-scripts/admin.mjs create-admin            # ADMIN_EMAIL, ADMIN_NAME, optional ADMIN_PASSWORD
 *   node dist-scripts/admin.mjs promote <email>          # grant system admin to an existing user (e.g. SSO-only)
 *   node dist-scripts/admin.mjs reset-password <email>   # set a new random password, sign out everywhere
 *   node dist-scripts/admin.mjs enable-local-auth        # re-enable e-mail/password login if locked out
 *   node dist-scripts/admin.mjs list-admins
 *
 * In Docker: docker compose exec app node dist-scripts/admin.mjs <command>
 */
import { randomBytes } from "node:crypto"
import { hashPassword } from "better-auth/crypto"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { applicationSettings, auditLogs, authAccounts, sessions, users } from "../src/db/schema"

const url = process.env.DATABASE_URL
if (!url) fail("DATABASE_URL is not set")

const sql = postgres(url!, { max: 1, onnotice: () => {} })
const db = drizzle(sql)

function fail(message: string): never {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function generatePassword() {
  return randomBytes(12).toString("base64url")
}

async function findUser(email: string | undefined) {
  if (!email) fail("e-mail is required")
  const [user] = await db.select().from(users).where(eq(users.email, email!.trim().toLowerCase()))
  if (!user) fail(`user ${email} not found`)
  return user!
}

async function setPassword(userId: string, password: string) {
  const hash = await hashPassword(password)
  const [existing] = await db
    .select({ id: authAccounts.id })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, "credential")))
  if (existing) await db.update(authAccounts).set({ password: hash }).where(eq(authAccounts.id, existing.id))
  else await db.insert(authAccounts).values({ userId, providerId: "credential", accountId: userId, password: hash })
}

async function audit(action: string, entityId: string | null) {
  await db.insert(auditLogs).values({ action, entityType: "user", entityId, actorId: null })
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  async "create-admin"() {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
    const name = process.env.ADMIN_NAME?.trim() || "Администратор"
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) fail("set ADMIN_EMAIL to a valid e-mail")
    const generated = !process.env.ADMIN_PASSWORD
    const password = process.env.ADMIN_PASSWORD ?? generatePassword()
    if (password.length < 10) fail("ADMIN_PASSWORD must be at least 10 characters")

    let [user] = await db.select().from(users).where(eq(users.email, email!))
    if (!user) [user] = await db.insert(users).values({ name, email: email!, emailVerified: true, role: "admin" }).returning()
    if (!user) fail("could not create the user")
    await db.update(users).set({ role: "admin", banned: false }).where(eq(users.id, user.id))
    await setPassword(user.id, password)
    await audit("cli.admin_created", user.id)
    console.log(`Administrator ready: ${email}`)
    if (generated) console.log(`Generated password (shown once): ${password}`)
  },

  async promote([email]) {
    const user = await findUser(email)
    await db.update(users).set({ role: "admin", banned: false }).where(eq(users.id, user.id))
    await audit("cli.promote", user.id)
    console.log(`${user.email} is now a system administrator`)
  },

  async "reset-password"([email]) {
    const user = await findUser(email)
    const password = generatePassword()
    await setPassword(user.id, password)
    await db.delete(sessions).where(eq(sessions.userId, user.id))
    await audit("cli.password_reset", user.id)
    console.log(`New password for ${user.email} (shown once): ${password}`)
  },

  async "enable-local-auth"() {
    await db
      .insert(applicationSettings)
      .values({ key: "auth.local_enabled", value: true })
      .onConflictDoUpdate({ target: applicationSettings.key, set: { value: true } })
    await audit("cli.local_auth_enabled", null)
    console.log("E-mail/password login enabled. It applies within a few seconds without restart.")
  },

  async "list-admins"() {
    const admins = await db.select({ email: users.email, name: users.name, banned: users.banned }).from(users).where(eq(users.role, "admin"))
    if (admins.length === 0) console.log("No administrators")
    for (const a of admins) console.log(`${a.email}\t${a.name}${a.banned ? "\t(banned)" : ""}`)
  },
}

const [command, ...args] = process.argv.slice(2)
const run = command ? commands[command] : undefined
if (!run) {
  console.log(`Usage: admin <${Object.keys(commands).join("|")}> [args]`)
  process.exit(command ? 1 : 0)
}

run!(args)
  .catch((err: unknown) => {
    console.error("Failed:", err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => sql.end({ timeout: 5 }))
