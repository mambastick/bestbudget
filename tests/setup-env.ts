import { inject } from "vitest"

process.env.DATABASE_URL = inject("databaseUrl")
process.env.APP_URL = "http://localhost:3000"
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-0123456789"
process.env.DB_POOL_MAX = "1"
