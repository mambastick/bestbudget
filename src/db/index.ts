import "server-only"
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { AsyncLocalStorage } from "node:async_hooks"
import { env } from "@/lib/env"
import * as schema from "./schema"

export type Db = PostgresJsDatabase<typeof schema>
/** Either the root connection or a transaction handle. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0]

const transactionScope = new AsyncLocalStorage<DbOrTx>()

/** Runs existing services against one transaction, including nested service savepoints. */
export function withDb<T>(db: DbOrTx, fn: () => Promise<T>): Promise<T> {
  return transactionScope.run(db, fn)
}

const globalForDb = globalThis as unknown as { __bestbudgetDb?: Db; __bestbudgetSql?: postgres.Sql }

function create(): Db {
  const sql = postgres(env().DATABASE_URL, {
    max: env().DB_POOL_MAX,
    onnotice: () => {},
  })
  globalForDb.__bestbudgetSql = sql
  return drizzle(sql, { schema })
}

/** Lazily-created singleton (survives hot reloads in development). */
export function getDb(): DbOrTx {
  const scoped = transactionScope.getStore()
  if (scoped) return scoped
  globalForDb.__bestbudgetDb ??= create()
  return globalForDb.__bestbudgetDb
}

export async function closeDb() {
  await globalForDb.__bestbudgetSql?.end({ timeout: 5 })
  globalForDb.__bestbudgetDb = undefined
  globalForDb.__bestbudgetSql = undefined
}

export { schema }
