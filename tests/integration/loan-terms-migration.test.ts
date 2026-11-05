import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { expect, it } from "vitest"

const household = "00000000-0000-4000-8000-000000000001"
const loan = "00000000-0000-4000-8000-000000000002"
const accounts = ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"]
const category = "00000000-0000-4000-8000-000000000005"

it("keeps loans and events intact and can use new event types in the same transaction", async () => {
  const db = new PGlite()
  const migrations = new URL("../../drizzle/", import.meta.url)
  try {
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrations), "utf8")) as { entries: { tag: string }[] }
    for (const entry of journal.entries) {
      const sql = readFileSync(new URL(`${entry.tag}.sql`, migrations), "utf8")
      if (entry.tag !== "0015_loan_terms_and_holidays") {
        await db.exec(sql)
        continue
      }
      await db.exec(`
        insert into households (id, name) values ('${household}', 'Synthetic');
        insert into categories (id, household_id, kind, name, icon) values ('${category}', '${household}', 'expense', 'Interest', 'landmark');
        insert into financial_accounts (id, household_id, name, kind, currency, opening_balance) values
          ('${accounts[0]}', '${household}', 'Debit', 'debit_card', 'RUB', 0),
          ('${accounts[1]}', '${household}', 'Mortgage', 'loan', 'RUB', -100000);
        insert into loans (id, household_id, account_id, lender, kind, principal, annual_rate, start_date, tracking_date, tracking_balance,
          first_payment_date, term_months, payment_day, schedule_type, interest_method, payment_account_id, interest_category_id)
          values ('${loan}', '${household}', '${accounts[1]}', 'Bank', 'mortgage', 100000, 12, '2024-01-01', '2024-01-01', 100000,
          '2024-02-01', 12, 1, 'annuity', 'monthly', '${accounts[0]}', '${category}');
        insert into loan_events (household_id, loan_id, type, date, amount, mode, annual_rate, balance, balance_delta) values
          ('${household}', '${loan}', 'prepayment', '2024-02-10', 500, 'reduce_term', null, null, null),
          ('${household}', '${loan}', 'rate_change', '2024-03-10', null, null, 9, null, null),
          ('${household}', '${loan}', 'reconciliation', '2024-04-10', null, null, null, 80000, 100);
      `)
      // Migrations run as one batch, so a value of the enum must be usable right after this file.
      await db.exec(`begin;
        ${sql};
        insert into loan_events (household_id, loan_id, type, date, annual_rate, next_payment_date, payment_day, term_months, schedule_type, interest_method)
          values ('${household}', '${loan}', 'restructuring', '2024-04-10', 9, '2024-05-10', 10, 24, 'annuity', 'monthly');
        rollback;`)
      await db.exec(sql)
    }
    expect((await db.query("select type, date::text, amount::int, mode, annual_rate::float as rate, balance::int, balance_delta::int as delta from loan_events order by date")).rows).toEqual([
      { type: "prepayment", date: "2024-02-10", amount: 500, mode: "reduce_term", rate: null, balance: null, delta: null },
      { type: "rate_change", date: "2024-03-10", amount: null, mode: null, rate: 9, balance: null, delta: null },
      { type: "reconciliation", date: "2024-04-10", amount: null, mode: null, rate: null, balance: 80000, delta: 100 },
    ])
    const event = (values: string) => `insert into loan_events (household_id, loan_id, type, date, ${values}`
    await db.exec(event(`annual_rate, next_payment_date, payment_day, term_months, schedule_type, interest_method) values ('${household}', '${loan}', 'correction', '2024-05-01', 9, '2024-06-01', 1, 12, 'annuity', 'monthly')`))
    await db.exec(event(`end_date, holiday_mode, holiday_interest, holiday_shift) values ('${household}', '${loan}', 'holiday', '2024-06-15', '2024-08-14', 'no_payment', 'deferred_end', 'extend_term')`))
    await db.exec(event(`end_date, holiday_mode, holiday_shift) values ('${household}', '${loan}', 'holiday', '2024-09-15', '2024-10-14', 'interest_only', 'keep_term')`))
    // The grid must follow the change, a balance always comes with its ledger adjustment, and a holiday needs its options.
    await expect(db.exec(event(`annual_rate, next_payment_date, payment_day, term_months, schedule_type, interest_method) values ('${household}', '${loan}', 'correction', '2025-01-01', 9, '2025-01-01', 1, 12, 'annuity', 'monthly')`))).rejects.toThrow()
    await expect(db.exec(event(`annual_rate, balance, next_payment_date, payment_day, term_months, schedule_type, interest_method) values ('${household}', '${loan}', 'restructuring', '2025-02-01', 9, 100, '2025-03-01', 1, 12, 'annuity', 'monthly')`))).rejects.toThrow()
    await expect(db.exec(event(`end_date, holiday_mode, holiday_shift) values ('${household}', '${loan}', 'holiday', '2025-03-01', '2025-04-01', 'no_payment', 'keep_term')`))).rejects.toThrow()
    await expect(db.exec(event(`end_date, holiday_mode, holiday_interest, holiday_shift, balance_delta) values ('${household}', '${loan}', 'holiday', '2025-03-01', '2025-04-01', 'no_payment', 'deferred_end', 'keep_term', -10)`))).rejects.toThrow()
    await expect(db.exec(event(`amount, mode, end_date) values ('${household}', '${loan}', 'prepayment', '2025-03-01', 10, 'reduce_term', '2025-04-01')`))).rejects.toThrow()
  } finally {
    await db.close()
  }
})
