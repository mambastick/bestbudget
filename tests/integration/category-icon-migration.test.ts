import { readFileSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { expect, it } from "vitest"
import { CATEGORY_ICONS } from "@/components/app/category-icon"

it("moves stored dog icons to the paw print and leaves other icons alone", async () => {
  const db = new PGlite()
  const migrations = new URL("../../drizzle/", import.meta.url)
  try {
    const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", migrations), "utf8")) as { entries: { tag: string }[] }
    for (const entry of journal.entries) {
      if (entry.tag === "0014_category_icon_paw_print") {
        await db.exec(`
          insert into households (id, name) values ('00000000-0000-4000-8000-000000000001', 'Synthetic');
          insert into categories (household_id, kind, name, icon) values
            ('00000000-0000-4000-8000-000000000001', 'expense', 'Pets', 'dog'),
            ('00000000-0000-4000-8000-000000000001', 'expense', 'Car', 'car');
          insert into goals (household_id, name, icon, target_amount, kind) values
            ('00000000-0000-4000-8000-000000000001', 'Vet', 'dog', 100, 'manual'),
            ('00000000-0000-4000-8000-000000000001', 'Trip', 'plane', 100, 'manual');
        `)
      }
      await db.exec(readFileSync(new URL(`${entry.tag}.sql`, migrations), "utf8"))
    }
    expect((await db.query("select name, icon from categories order by name")).rows).toEqual([{ name: "Car", icon: "car" }, { name: "Pets", icon: "paw-print" }])
    expect((await db.query("select name, icon from goals order by name")).rows).toEqual([{ name: "Trip", icon: "plane" }, { name: "Vet", icon: "paw-print" }])
    expect(CATEGORY_ICONS["paw-print"]).toBeDefined()
    expect(CATEGORY_ICONS.dog).toBeUndefined()
  } finally { await db.close() }
})
