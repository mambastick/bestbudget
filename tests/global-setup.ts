import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import type { TestProject } from "vitest/node"
import { runMigrations } from "../src/db/migrate"

/** Starts an in-memory PostgreSQL (PGlite) over TCP and applies the real migrations. */
export default async function setup(project: TestProject) {
  if (process.env.TEST_POSTGRES_URL) {
    const url = new URL(process.env.TEST_POSTGRES_URL)
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.startsWith("/bestbudget_test_")) {
      throw new Error("TEST_POSTGRES_URL must point to a local, isolated bestbudget_test_* database")
    }
    await runMigrations(url.href, path.resolve(import.meta.dirname, "../drizzle"))
    project.provide("databaseUrl", url.href)
    return
  }
  const db = new PGlite()
  await db.waitReady
  const port = 55000 + Math.floor(Math.random() * 5000)
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 20 })
  await server.start()
  const url = `postgres://postgres@127.0.0.1:${port}/postgres`
  await runMigrations(url, path.resolve(import.meta.dirname, "../drizzle"))
  project.provide("databaseUrl", url)

  return async () => {
    await server.stop()
    await db.close()
  }
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string
  }
}
