import { setTimeout as delay } from "node:timers/promises"
import postgres from "postgres"
import { E2E_ENV } from "../playwright.config"

let pending: Promise<unknown> = Promise.resolve()

function serialize<T>(run: () => Promise<T>): Promise<T> {
  const result = pending.then(run)
  pending = result.catch(() => {})
  return result
}

function isTransient(error: unknown) {
  if (!(error instanceof Error)) return false
  const code = "code" in error ? error.code : undefined
  return code === "08P01" || (code === "34000" && /portal .* does not exist/i.test(error.message))
}

/** Serialize test-side SQL; never replay a write whose commit state is unknown. */
export function createE2eDb() {
  const query = <T extends readonly (object | undefined)[] = postgres.Row[]>(
    template: TemplateStringsArray,
    ...parameters: readonly postgres.ParameterOrFragment<never>[]
  ): Promise<postgres.RowList<T>> => serialize(async () => {
    const readOnly = /^\s*select\b/i.test(template[0] ?? "")
    for (let attempt = 0; ; attempt++) {
      const sql = postgres(E2E_ENV.DATABASE_URL, { max: 1, prepare: true, onnotice: () => {} })
      try {
        return await sql<T>(template, ...parameters)
      } catch (error) {
        if (!readOnly || !isTransient(error) || attempt >= 3) throw error
      } finally {
        await sql.end({ timeout: 1 })
      }
      await delay(100 * (attempt + 1))
    }
  })
  return Object.assign(query, { end: async () => { await pending } })
}

export type E2eDb = ReturnType<typeof createE2eDb>

export async function withDb<T>(run: (sql: E2eDb) => Promise<T>): Promise<T> {
  const sql = createE2eDb()
  try { return await run(sql) } finally { await sql.end() }
}
