import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import postgres, { type Sql } from "postgres"

import * as schema from "./schema"

let sqlClient: Sql | null = null
let database: PostgresJsDatabase<typeof schema> | null = null

export function getDatabase() {
  if (database) {
    return database
  }

  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error("DATABASE_URL is required before creating a database client")
  }

  sqlClient = postgres(connectionString, {
    max: 10,
    prepare: false,
  })
  database = drizzle(sqlClient, { schema })

  return database
}

export async function closeDatabase() {
  if (sqlClient) {
    await sqlClient.end()
  }

  sqlClient = null
  database = null
}
