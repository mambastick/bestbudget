import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { expect, it } from "vitest"

it("upgrades populated beta data without changing native RUB amounts", async () => {
  const db = new PGlite()
  try {
    await db.exec(readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8"))
    await db.exec(`
      insert into households(id, name) values ('00000000-0000-4000-8000-000000000001', 'Beta');
      insert into financial_accounts(id, household_id, name, opening_balance) values
        ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'RUB', 123456),
        ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Savings', 0);
      insert into transactions(household_id, type, status, title, date, account_id, to_account_id, amount) values
        ('00000000-0000-4000-8000-000000000001', 'transfer', 'posted', 'Beta transfer', '2026-10-01', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 12345);
    `)
    await db.exec(readFileSync(new URL("../../drizzle/0001_multicurrency.sql", import.meta.url), "utf8"))
    await db.exec(readFileSync(new URL("../../drizzle/0002_currency_edit_versions.sql", import.meta.url), "utf8"))
    expect((await db.query("select amount::text, to_amount from transactions")).rows).toEqual([{ amount: "12345", to_amount: null }])
    expect((await db.query("select currency, opening_balance::text, version from financial_accounts order by id")).rows).toEqual([
      { currency: "RUB", opening_balance: "123456", version: 1 }, { currency: "RUB", opening_balance: "0", version: 1 },
    ])
    expect((await db.query("select currency, version from households")).rows).toEqual([{ currency: "RUB", version: 1 }])
  } finally {
    await db.close()
  }
})
