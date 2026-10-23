import { createHash } from "node:crypto"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import { expect, it } from "vitest"
import { runMigrations } from "@/db/migrate"
import history from "../fixtures/oidc-upgrade-journal.json"

const migrations = fileURLToPath(new URL("../../drizzle", import.meta.url))

it.each([
  ["beta.3", history.entries.length],
  ["PR #10 candidate", history.candidateMigrationCount],
])("upgrades populated %s with the production migrator and can restart safely", async (_, count) => {
  const folder = await mkdtemp(path.join(tmpdir(), "bestbudget-oidc-upgrade-"))
  const db = new PGlite()
  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1" })
  try {
    await db.waitReady
    await server.start()
    const url = `postgres://postgres@${server.getServerConn()}/postgres`
    const entries = history.entries.slice(0, count)
    await mkdir(path.join(folder, "meta"))
    for (const entry of entries) {
      const source = path.join(migrations, `${entry.tag}.sql`)
      // Pin the exact published SQL and timestamps, including the candidate's real journal.
      expect(createHash("sha256").update(await readFile(source)).digest("hex")).toBe(entry.hash)
      await copyFile(source, path.join(folder, `${entry.tag}.sql`))
    }
    await writeFile(path.join(folder, "meta/_journal.json"), JSON.stringify({
      version: history.version, dialect: history.dialect,
      entries: entries.map((entry) => ({ idx: entry.idx, version: entry.version, when: entry.when, tag: entry.tag, breakpoints: entry.breakpoints })),
    }))
    await runMigrations(url, folder)
    await db.exec(`
      insert into users(id, name, email, role) values
        ('00000000-0000-4000-8000-000000000001', 'SSO Admin', 'admin@upgrade.test', 'admin'),
        ('00000000-0000-4000-8000-000000000002', 'Local User', 'local@upgrade.test', 'user');
      insert into auth_accounts(account_id, provider_id, user_id, password) values
        ('stable-subject', 'oidc', '00000000-0000-4000-8000-000000000001', null),
        ('00000000-0000-4000-8000-000000000002', 'credential', '00000000-0000-4000-8000-000000000002', 'synthetic-password-hash');
      insert into sessions(token, user_id, expires_at) values
        ('synthetic-existing-session', '00000000-0000-4000-8000-000000000001', '2099-01-01');
      insert into households(id, name, created_by) values
        ('00000000-0000-4000-8000-000000000003', 'Preserved family', '00000000-0000-4000-8000-000000000001');
      insert into household_members(household_id, user_id, role) values
        ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'owner'),
        ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'member');
      insert into financial_accounts(id, household_id, name, opening_balance) values
        ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003', 'RUB', 9007199254740000);
      insert into categories(id, household_id, kind, name) values
        ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003', 'expense', 'Food');
      insert into category_budgets(household_id, category_id, amount, updated_by) values
        ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005', 15000, '00000000-0000-4000-8000-000000000001');
      insert into transactions(household_id, type, status, title, date, account_id, category_id, amount) values
        ('00000000-0000-4000-8000-000000000003', 'expense', 'posted', 'Preserved expense', '2026-10-22', '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005', 12345);
      insert into oidc_provider_settings(id, enabled, issuer_url, client_id, client_secret_encrypted, scopes) values
        (1, true, 'https://id.upgrade.test', 'bestbudget', 'synthetic-encrypted-secret', 'openid profile email groups');
    `)
    if (count === history.entries.length) {
      await db.exec("update users set locale = 'en', last_seen_locale = 'ru' where role = 'admin'")
    }
    const snapshot = async () => ({
      users: (await db.query("select id, name, email, role, banned, created_at, updated_at from users order by id")).rows,
      accounts: (await db.query("select * from auth_accounts order by id")).rows,
      sessions: (await db.query("select * from sessions order by id")).rows,
      households: (await db.query("select * from households order by id")).rows,
      memberships: (await db.query("select * from household_members order by user_id")).rows,
      balances: (await db.query("select id, opening_balance::text, version from financial_accounts order by id")).rows,
      categories: (await db.query("select id, household_id, kind, name from categories order by id")).rows,
      budgets: (await db.query("select household_id, category_id, amount::text from category_budgets order by id")).rows,
      transactions: (await db.query("select id, household_id, title, date::text, amount::text, version from transactions order by id")).rows,
      oidc: (await db.query("select * from oidc_provider_settings")).rows,
    })
    const before = await snapshot()
    const locales = count === history.entries.length
      ? (await db.query("select locale, last_seen_locale from users order by id")).rows
      : [{ locale: null, last_seen_locale: "ru" }, { locale: null, last_seen_locale: "ru" }]
    const journalBefore = (await db.query("select * from drizzle.__drizzle_migrations order by id")).rows
    expect(journalBefore).toMatchObject(entries.map((entry) => ({ hash: entry.hash, created_at: entry.when })))

    await runMigrations(url, migrations)
    expect(await snapshot()).toEqual(before)
    expect((await db.query("select locale, last_seen_locale from users order by id")).rows).toEqual(locales)
    const journalAfter = (await db.query("select * from drizzle.__drizzle_migrations order by id")).rows
    expect(journalAfter.slice(0, count)).toEqual(journalBefore)
    expect(journalAfter.slice(0, history.entries.length)).toMatchObject(history.entries.map((entry) => ({ hash: entry.hash, created_at: entry.when })))
    const current = JSON.parse(await readFile(path.join(migrations, "meta/_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] }
    const applied = await Promise.all(current.entries.map(async (entry) => ({
      hash: createHash("sha256").update(await readFile(path.join(migrations, `${entry.tag}.sql`))).digest("hex"),
      created_at: entry.when,
    })))
    expect(journalAfter).toMatchObject(applied)
    expect((await db.query("select version from categories")).rows).toEqual([{ version: 1 }])
    expect((await db.query("select version from category_budgets")).rows).toEqual([{ version: 1 }])

    await runMigrations(url, migrations)
    expect(await snapshot()).toEqual(before)
    expect((await db.query("select locale, last_seen_locale from users order by id")).rows).toEqual(locales)
    expect((await db.query("select * from drizzle.__drizzle_migrations order by id")).rows).toEqual(journalAfter)
  } finally {
    await server.stop()
    await db.close()
    await rm(folder, { recursive: true, force: true })
  }
})
