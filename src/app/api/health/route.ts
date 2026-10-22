import { sql } from "drizzle-orm"
import { getDb } from "@/db"

export const dynamic = "force-dynamic"

/** Liveness + database readiness probe for Docker health checks. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`)
    return Response.json({ status: "ok" })
  } catch {
    return Response.json({ status: "error", database: "unavailable" }, { status: 503 })
  }
}
