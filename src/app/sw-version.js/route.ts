import { randomUUID } from "node:crypto"

// Generated once by next build, identical on all replicas of that artifact.
export const dynamic = "force-static"

export function GET() {
  return new Response(`self.BESTBUDGET_BUILD = ${JSON.stringify(randomUUID())};`, {
    headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache, no-store, must-revalidate" },
  })
}
