import { afterEach, beforeEach, inject, vi } from "vitest"
import { testNow } from "./clock"

// Freeze wall time before fixture hooks; keep I/O timers real for PostgreSQL.
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: testNow }))
afterEach(() => vi.useRealTimers())

process.env.DATABASE_URL = inject("databaseUrl")
process.env.APP_URL = "http://localhost:3000"
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123456789"
process.env.DB_POOL_MAX = "1"

process.env.FX_PROVIDER = "none"
