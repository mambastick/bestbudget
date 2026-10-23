import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { expect, it } from "vitest"

const migrations = new URL("../../drizzle/", import.meta.url)

it("upgrades beta operations, transfers and recurring rules without changing RUB data", async () => {
  const db = new PGlite()
  try {
    await db.exec(readFileSync(new URL("0000_init.sql", migrations), "utf8"))
    await db.exec(`
      insert into households(id, name) values ('00000000-0000-4000-8000-000000000001', 'Beta');
      insert into financial_accounts(id, household_id, name, opening_balance) values
        ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'RUB', 123456),
        ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Savings', 0);
      insert into categories(id, household_id, kind, name) values
        ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'income', 'Salary'),
        ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'expense', 'Food');
      insert into recurring_rules(id, household_id, type, title, amount, category_id, account_id, to_account_id, frequency, start_date, generate_from) values
        ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', 'transfer', 'Beta transfer rule', 54321, null, '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'monthly', '2026-10-01', '2026-10-01'),
        ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', 'expense', 'Beta expense rule', 7654, '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002', null, 'monthly', '2026-10-01', '2026-10-01');
      insert into transactions(household_id, type, status, title, date, account_id, to_account_id, category_id, recurring_rule_id, occurrence_date, amount) values
        ('00000000-0000-4000-8000-000000000001', 'transfer', 'posted', 'Beta transfer', '2026-10-01', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', null, null, null, 12345),
        ('00000000-0000-4000-8000-000000000001', 'income', 'posted', 'Beta income', '2026-10-01', '00000000-0000-4000-8000-000000000002', null, '00000000-0000-4000-8000-000000000004', null, null, 100000),
        ('00000000-0000-4000-8000-000000000001', 'expense', 'posted', 'Beta expense', '2026-10-01', '00000000-0000-4000-8000-000000000002', null, '00000000-0000-4000-8000-000000000005', null, null, 6789),
        ('00000000-0000-4000-8000-000000000001', 'transfer', 'planned', 'Beta rule occurrence', '2026-10-01', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', null, '00000000-0000-4000-8000-000000000006', '2026-10-01', 54321);
    `)
    const beforeOperations = (await db.query("select id, type, status, title, date, account_id, to_account_id, category_id, recurring_rule_id, occurrence_date, amount::text, version from transactions order by title")).rows
    const beforeRules = (await db.query("select id, title, amount::text, account_id, to_account_id, category_id, start_date, generate_from, version from recurring_rules order by title")).rows
    // Use the journal so the upgrade test also remains valid after additive migrations/rebases.
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrations), "utf8")) as { entries: { tag: string }[] }
    for (const entry of journal.entries.filter((entry) => entry.tag !== "0000_init")) {
      await db.exec(readFileSync(new URL(`${entry.tag}.sql`, migrations), "utf8"))
      if (entry.tag === "0005_savings_goals") {
        // Exercise the loan upgrade with existing goals and an automatic funding link from main.
        await db.exec(`
          insert into goals(id, household_id, name, kind, account_id, target_amount) values
            ('00000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000001', 'Beta goal', 'account', '00000000-0000-4000-8000-000000000003', 300000);
          update recurring_rules set goal_id = '00000000-0000-4000-8000-000000000008' where id = '00000000-0000-4000-8000-000000000006';
        `)
      }
    }
    expect((await db.query("select id, type, status, title, date, account_id, to_account_id, category_id, recurring_rule_id, occurrence_date, amount::text, version from transactions order by title")).rows).toEqual(beforeOperations)
    expect((await db.query("select id, title, amount::text, account_id, to_account_id, category_id, start_date, generate_from, version from recurring_rules order by title")).rows).toEqual(beforeRules)
    expect((await db.query("select to_amount from transactions union all select to_amount from recurring_rules")).rows).toEqual(Array.from({ length: 6 }, () => ({ to_amount: null })))
    expect((await db.query("select currency, opening_balance::text, version from financial_accounts order by id")).rows).toEqual([
      { currency: "RUB", opening_balance: "123456", version: 1 }, { currency: "RUB", opening_balance: "0", version: 1 },
    ])
    expect((await db.query("select g.name, g.target_amount::text, g.version, r.title from goals g join recurring_rules r on r.goal_id = g.id")).rows).toEqual([
      { name: "Beta goal", target_amount: "300000", version: 1, title: "Beta transfer rule" },
    ])
    expect((await db.query("select credit_limit::text from financial_accounts order by id")).rows).toEqual([{ credit_limit: "0" }, { credit_limit: "0" }])
    expect((await db.query("select count(*)::int as n from transactions where loan_id is not null")).rows).toEqual([{ n: 0 }])
    expect((await db.query("select currency, version from households")).rows).toEqual([{ currency: "RUB", version: 1 }])
    expect((await db.query("select indexdef from pg_indexes where indexname = 'transactions_household_status_date_idx'")).rows).toEqual([
      { indexdef: expect.stringContaining("(household_id, status, date)") },
    ])
    // Existing RUB transfer rules can still materialize after all migrations, with no to_amount backfill needed.
    await db.exec(`insert into transactions(household_id, type, status, title, date, account_id, to_account_id, recurring_rule_id, occurrence_date, amount)
      select household_id, type, 'planned', title, '2026-11-01', account_id, to_account_id, id, '2026-11-01', amount from recurring_rules where type = 'transfer'`)
    expect((await db.query("select amount::text, coalesce(to_amount, amount)::text as credited from transactions where date = '2026-11-01'")).rows).toEqual([{ amount: "54321", credited: "54321" }])
  } finally {
    await db.close()
  }
})
