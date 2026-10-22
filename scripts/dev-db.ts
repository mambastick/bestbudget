/**
 * Local development database without Docker: an embedded PostgreSQL (PGlite)
 * exposed over the regular wire protocol, so the app uses the same `postgres` driver.
 *
 *   pnpm db:dev            # persistent, stored in .data/pglite
 *   PGLITE_MEMORY=1 pnpm db:dev
 */
import { mkdirSync } from "node:fs"
import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"

const port = Number(process.env.PGLITE_PORT ?? 54329)
if (!process.env.PGLITE_MEMORY) mkdirSync(".data/pglite", { recursive: true })
const db = process.env.PGLITE_MEMORY ? new PGlite() : new PGlite(".data/pglite")
await db.waitReady
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 20 })
await server.start()
console.log(`PGlite listening: postgres://postgres@127.0.0.1:${port}/postgres`)

const stop = async () => {
  await server.stop()
  await db.close()
  process.exit(0)
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
