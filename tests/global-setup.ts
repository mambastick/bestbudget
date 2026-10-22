import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import type { TestProject } from "vitest/node"
import { runMigrations } from "../src/db/migrate"

/** Starts an in-memory PostgreSQL (PGlite) over TCP and applies the real migrations. */
export default async function setup(project: TestProject) {
  const db = new PGlite()
  await db.waitReady
  const port = 55000 + Math.floor(Math.random() * 5000)
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" })
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
