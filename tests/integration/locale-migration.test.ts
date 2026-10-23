import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { expect, it } from "vitest"

it("adds the background locale fallback to populated profiles without changing preferences", async () => {
  const db = new PGlite()
  const migrations = new URL("../../drizzle/", import.meta.url)
  try {
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrations), "utf8")) as { entries: { tag: string }[] }
    for (const entry of journal.entries) {
      if (entry.tag === "0009_recipient_last_seen_locale") {
        await db.exec("insert into users (name, email, locale) values ('System', 'system@test', null), ('Russian', 'ru@test', 'ru'), ('English', 'en@test', 'en')")
      }
      await db.exec(readFileSync(new URL(`${entry.tag}.sql`, migrations), "utf8"))
    }
    expect((await db.query("select name, locale, last_seen_locale from users order by name")).rows).toEqual([
      { name: "English", locale: "en", last_seen_locale: null },
      { name: "Russian", locale: "ru", last_seen_locale: null },
      { name: "System", locale: null, last_seen_locale: null },
    ])
  } finally { await db.close() }
})
