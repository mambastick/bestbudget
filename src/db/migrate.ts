import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"

/** Applies pending SQL migrations from `migrationsFolder`. Safe to run on every start. */
export async function runMigrations(databaseUrl: string, migrationsFolder: string) {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} })
  try {
    // Serialize concurrent starts (e.g. two replicas) with an advisory lock.
    await sql`select pg_advisory_lock(7428301)`
    await migrate(drizzle(sql), { migrationsFolder })
    await sql`select pg_advisory_unlock(7428301)`
  } finally {
    await sql.end({ timeout: 5 })
  }
}
